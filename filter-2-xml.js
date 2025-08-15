const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false } });
const zlib = require('zlib');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

// Lista de URLs a obtener (puedes añadir más)
const urlsXML = [
  'https://www.open-epg.com/generate/qdRtF5sAjR.xml.gz',
  'https://raw.githubusercontent.com/HelmerLuzo/RakutenTV_HL/main/epg/RakutenTV.xml.gz',
  'https://i.mjh.nz/Plex/mx.xml.gz'
];

// Función para obtener el offset horario de España (Europe/Madrid) en horas
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

// Define fechas de filtrado (desde hoy 06:00 hasta mañana 06:00 en horario España)
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

// Descomprimir XML desde .gz
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

// Parsear y procesar XML desde varias fuentes
async function fetchXMLFromSources() {
  const xmlDataList = await Promise.all(urlsXML.map(async (url) => {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/xml',
        }
      });
      return await decompressXML(response.data);
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

  const canalesPermitidos = [
    'Atrescine.ar', 'Russia Today HD.ar', 'Top Gear.es', 'Todo Novelas.es', 'Vive Kanal D Drama.es', 'TV Melilla.es', 'Oficios perdidos.es',
    'Motorvision TV.es', 'Red Bull TV.es', 'Canal Parlamento.es', 'Actualidad 360.es', 'El Confidencial.es',
    'El País.es', 'France 24 ES.es', 'DW en español.es', 'Yu-Gi-Oh!.es', 'Pitufo TV.es', 'La Abeja Maya.es', 
    'hola-play-2108fd06-86d4-44e8-9867-c35b4895a1c1', 'tastemade-sp',
    '608049aefa2b8ae93c2c3a63-67a1a8ef2358ef4dd5c3018e'
  ];

  // Extraer y filtrar programas
  const programasFiltrados = parsedList.flatMap(parsed => {
    if (!parsed?.tv?.programme) return [];
    return parsed.tv.programme.filter(p => {
      const startDateTime = parseStartDate(p.$.start);
      const endDateTime = parseStartDate(p.$.stop);
      return endDateTime > hoy0600 && startDateTime < manana0600;
    }).filter(p => canalesPermitidos.includes(p.$.channel));
  });

  // Estructura final
  const programasXML = programasFiltrados.map(p => ({
    $: { channel: p.$.channel, start: p.$.start, stop: p.$.stop },
    title: p.title?.[0] || '',
    'sub-title': p['sub-title']?.[0] || '',
    desc: p.desc?.[0] || '',
    icon: p.icon?.[0]?.$?.src ? { $: { src: p.icon[0].$.src } } : undefined,
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

// Convertir fechas del XML (UTC con offset) a objeto Date
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
