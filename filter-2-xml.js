const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false } });
const zlib = require('zlib');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

const fuentesXML = [
  'https://www.open-epg.com/files/spain5.xml.gz',
  'https://i.mjh.nz/Plex/us.xml.gz',
];

const canalesFiltrados = [
  'Pitufo TV.es',
  'La Abeja Maya.es',
  '5e20b730f2f8d5003d739db7-67a1a8ef2358ef4dd5c3018e'
];

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

async function fetchAllXMLs() {
  const { hoy0600, manana0600 } = definirFechasFiltrado();
  let todosLosProgramas = [];

  for (const url of fuentesXML) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept': 'application/xml',
        }
      });

      const xmlData = await decompressXML(response.data);

      const programas = await parseXML(xmlData, hoy0600, manana0600);
      todosLosProgramas.push(...programas);

    } catch (error) {
      console.error(`❌ Error procesando ${url}:`, error.message);
    }
  }

  const xmlFinal = builder.buildObject({ tv: { programme: todosLosProgramas } });
  fs.writeFileSync('./programacion-2-hoy.xml', xmlFinal);
  console.log(`✅ Archivo XML creado correctamente con ${todosLosProgramas.length} programas.`);
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

function parseXML(xmlData, hoy0600, manana0600) {
  return new Promise((resolve, reject) => {
    xml2js.parseString(xmlData, { trim: true }, (err, result) => {
      if (err) return reject(err);

      const programas = result.tv.programme || [];

      const filtrados = programas
        .filter(p => {
          const start = parseStartDate(p.$.start);
          const end = parseStartDate(p.$.stop);
          return end > hoy0600 && start < manana0600;
        })
        .filter(p => canalesFiltrados.includes(p.$.channel))
        .map(p => ({
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

      resolve(filtrados);
    });
  });
}

// Ejecutar
fetchAllXMLs();

