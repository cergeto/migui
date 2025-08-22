const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false } });
const zlib = require('zlib');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

// Lista de fuentes: comprimidas y no comprimidas
const fuentesXML = [
  { url: 'https://www.open-epg.com/generate/qdRtF5sAjR.xml.gz', comprimido: true },
  { url: 'https://raw.githubusercontent.com/HelmerLuzo/RakutenTV_HL/main/epg/RakutenTV.xml.gz', comprimido: true },
  { url: 'https://raw.githubusercontent.com/matthuisman/i.mjh.nz/master/Plex/mx.xml.gz', comprimido: true },
  { url: 'https://raw.githubusercontent.com/acidjesuz/EPGTalk/master/Latino_guide.xml.gz', comprimido: true },
  { url: 'https://raw.githubusercontent.com/dvds1151/AR-TV/main/epg/artv-guide.xml', comprimido: false } // XML sin comprimir
];

// Obtener offset horario de España (Europe/Madrid) en horas
function getSpainOffsetHours(date = new Date()) {
  const options = { timeZone: 'Europe/Madrid', hour12: false, hour: '2-digit', minute: '2-digit' };
  const spainTimeString = date.toLocaleString('en-GB', options);

  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();

  const [spainHours, spainMinutes] = spainTimeString.split(':').map(Number);

  let offsetMinutes = (spainHours * 60 + spainMinutes) - (utcHours * 60 + utcMinutes);

  if (offsetMinutes > 720) offsetMinutes -= 1440;
  else if (offsetMinutes < -720) offsetMinutes += 1440;

  return offsetMinutes / 60;
}

// Fechas de filtro: hoy 06:00 hasta mañana 06:00 (UTC)
function definirFechasFiltrado() {
  const ahora = new Date();
  const tzOffsetHoras = getSpainOffsetHours(ahora);

  const hoy0600 = new Date(Date.UTC(
    ahora.getUTCFullYear(),
    ahora.getUTCMonth(),
    ahora.getUTCDate(),
    6 - tzOffsetHoras, 0, 0, 0
  ));

  const manana0600 = new Date(hoy0600);
  manana0600.setUTCDate(manana0600.getUTCDate() + 1);

  console.log('Offset horario España:', tzOffsetHoras);
  console.log('Hoy 06:00 (UTC):', hoy0600.toISOString());
  console.log('Mañana 06:00 (UTC):', manana0600.toISOString());

  return { hoy0600, manana0600 };
}

// Descomprimir .gz
async function decompressXML(compressedData) {
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    const chunks = [];
    const streamData = stream.Readable.from(compressedData);

    streamData.pipe(gunzip);

    gunzip.on('data', chunk => chunks.push(chunk));
    gunzip.on('end', () => resolve(Buffer.concat(chunks).toString()));
    gunzip.on('error', err => reject(err));
  });
}

// Procesar fuentes comprimidas y no comprimidas
async function fetchXMLFromSources() {
  const xmlDataList = await Promise.all(fuentesXML.map(async ({ url, comprimido }) => {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/xml',
        }
      });

      const rawData = Buffer.from(response.data);

      const xmlString = comprimido
        ? await decompressXML(rawData)
        : rawData.toString();

      return xmlString;

    } catch (error) {
      console.error(`Error al obtener/parsing XML desde: ${url}`, error.message);
      return null;
    }
  }));

  const parsedList = await Promise.all(xmlDataList.map(async (xmlStr) => {
    if (!xmlStr) return null;
    return new Promise((resolve, reject) => {
      xml2js.parseString(xmlStr, { trim: true }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }));

  const { hoy0600, manana0600 } = definirFechasFiltrado();

  // Canales que quieres permitir
  const canalesPermitidos = [
    'Oficios perdidos.es', 'Canal Parlamento.es', 'Actualidad 360.es', 'DW en español.es', 'La Abeja Maya.es',
    'tastemade-sp', 'cops-en-espanol', 'cine-western-es',
    '608049aefa2b8ae93c2c3a63-67a1a8ef2358ef4dd5c3018e',
    'I41.82808.schedulesdirect.org',
    'Atrescine.es', 'RTenEspanol.ru', 'France24.fr@Spanish', 'GaliciaTVAmerica.es', 'GarageTVLatinAmerica.ar' 
  ];

  const programasFiltrados = parsedList.flatMap(parsed => {
    if (!parsed?.tv?.programme) return [];
    return parsed.tv.programme.filter(p => {
      const startDateTime = parseStartDate(p.$.start);
      const endDateTime = parseStartDate(p.$.stop);
      return endDateTime > hoy0600 && startDateTime < manana0600;
    }).filter(p => canalesPermitidos.includes(p.$.channel));
  });

  const programasXML = programasFiltrados.map(p => ({
    $: { channel: p.$.channel, start: p.$.start, stop: p.$.stop },
    title: p.title?.[0] || '',
    'sub-title': p['sub-title']?.[0] || '',
    desc: p.desc?.[0] || '',
    category: p.category?.[0] || '', // 🆕 Si quieres usarla luego
    icon: p.image?.[0] // Algunas fuentes usan <image> en vez de <icon>
      ? { $: { src: p.image[0] } }
      : p.icon?.[0]?.$?.src
        ? { $: { src: p.icon[0].$.src } }
        : undefined,
    'episode-num': p['episode-num']?.[0]
      ? {
        _: typeof p['episode-num'][0] === 'string' ? p['episode-num'][0] : '',
        $: { system: p['episode-num'][0].$.system || 'xmltv_ns' }
      }
      : undefined
  }));

  const xmlFinal = builder.buildObject({ tv: { programme: programasXML } });
  fs.writeFileSync('./programacion-2-hoy.xml', xmlFinal);
  console.log('Archivo XML combinado creado correctamente');
}

// Convertir fechas XML con zona horaria a objeto Date UTC
function parseStartDate(startDate) {
  const dateTimePart = startDate.slice(0, 14);
  const tzPart = startDate.slice(15).trim();

  const formattedDate = `${dateTimePart.slice(0, 4)}-${dateTimePart.slice(4, 6)}-${dateTimePart.slice(6, 8)}T` +
                        `${dateTimePart.slice(8, 10)}:${dateTimePart.slice(10, 12)}:${dateTimePart.slice(12, 14)}`;

  const date = new Date(formattedDate + 'Z');

  const offsetSign = tzPart[0];
  const offsetHours = parseInt(tzPart.slice(1, 3), 10);
  const offsetMinutes = parseInt(tzPart.slice(3, 5), 10);
  const totalOffset = (offsetHours * 60) + offsetMinutes;

  if (offsetSign === '+') {
    date.setMinutes(date.getMinutes() - totalOffset);
  } else if (offsetSign === '-') {
    date.setMinutes(date.getMinutes() + totalOffset);
  }

  return date;
}

// Ejecutar
fetchXMLFromSources();
