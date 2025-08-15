const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false } });
const zlib = require('zlib');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

const urlXMLIconos = 'https://www.open-epg.com/files/spain5.xml.gz';

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

// Función para definir fechas de filtro hoy a las 06:00 y mañana a las 06:00 (en UTC ajustado a España)
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

async function fetchXML() {
  try {
    const responseXMLIconos = await axios.get(urlXMLIconos, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': '',
        'Origin': '',
        'X-Forwarded-For': '',
        'Connection': 'keep-alive',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'application/xml',
      }
    });

    const xmlIconosData = await decompressXML(responseXMLIconos.data);
    parseXML(xmlIconosData);
  } catch (error) {
    console.error('Error al obtener el archivo XML comprimido:', error);
  }
}

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

function parseXML(xmlIconosData) {
  xml2js.parseString(xmlIconosData, { trim: true }, (errIconos, resultIconos) => {
    if (errIconos) {
      console.error('Error al parsear el XML de iconos:', errIconos);
      return;
    }

    const { hoy0600, manana0600 } = definirFechasFiltrado();

    const programasFiltrados = resultIconos.tv.programme
      .filter(p => {
        const startDateTime = parseStartDate(p.$.start);
        const endDateTime = parseStartDate(p.$.stop);
        return endDateTime > hoy0600 && startDateTime < manana0600;
      })
      .filter(p => 
        [
          'Top Gear.es', 'Todo Novelas.es', 'Vive Kanal D Drama.es', 'TV Melilla.es', 'Oficios perdidos.es', 'Canal Parlamento.es', 'Actualidad 360.es', 'El Confidencial.es', 
          'El País.es', 'France 24 ES.es', 'DW en español.es', 'Yu-Gi-Oh!.es', 'Pitufo TV.es', 'La Abeja Maya.es'
        ].includes(p.$.channel));

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

    const xmlMin = builder.buildObject({ tv: { programme: programasXML } });
    fs.writeFileSync('./programacion-2-hoy.xml', xmlMin);
    console.log('Archivo XML creado correctamente');
  });
}

// Convierte la fecha del formato 'YYYYMMDDhhmmss +TZ' a un objeto Date ajustado a UTC
function parseStartDate(startDate) {
  const dateTimePart = startDate.slice(0, 14);
  const tzPart = startDate.slice(15).trim();

  const formattedDate = `${dateTimePart.slice(0, 4)}-${dateTimePart.slice(4, 6)}-${dateTimePart.slice(6, 8)}T` +
                        `${dateTimePart.slice(8, 10)}:${dateTimePart.slice(10, 12)}:${dateTimePart.slice(12, 14)}`;

  // Creamos fecha en UTC
  const date = new Date(formattedDate + 'Z');

  // Ajustamos minutos según offset del XML (por ejemplo +0200)
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
fetchXML();
