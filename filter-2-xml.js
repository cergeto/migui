const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const zlib = require('zlib');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false } });

const fuentesXML = [
  { url: 'https://www.open-epg.com/generate/qdRtF5sAjR.xml.gz', comprimido: true },
  { url: 'https://raw.githubusercontent.com/HelmerLuzo/RakutenTV_HL/main/epg/RakutenTV.xml.gz', comprimido: true },
  { url: 'https://raw.githubusercontent.com/matthuisman/i.mjh.nz/master/Plex/mx.xml.gz', comprimido: true },
  { url: 'https://raw.githubusercontent.com/acidjesuz/EPGTalk/master/Latino_guide.xml.gz', comprimido: true },
  { url: 'https://raw.githubusercontent.com/dvds1151/AR-TV/main/epg/artv-guide.xml', comprimido: false },
  { url: 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/tiviepg.xml', comprimido: false }
];

// Convertir XMLTV fecha→Date UTC
function parseStartDate(dt) {
  const dateTime = dt.slice(0,14);
  const tz = dt.slice(15).trim();
  const f = `${dateTime.slice(0,4)}-${dateTime.slice(4,6)}-${dateTime.slice(6,8)}T${dateTime.slice(8,10)}:${dateTime.slice(10,12)}:${dateTime.slice(12,14)}Z`;
  const d = new Date(f);
  if (tz) {
    const sign = tz[0];
    const h = parseInt(tz.slice(1,3)), m = parseInt(tz.slice(3,5));
    const off = h*60+m;
    d.setMinutes(d.getMinutes() + (sign === '+' ? -off : off));
  }
  return d;
}

function getSpainOffsetHours(date = new Date()) {
  const opt = { timeZone: 'Europe/Madrid', hour12: false, hour: '2-digit', minute: '2-digit' };
  const sp = date.toLocaleString('en-GB', opt);
  const [sh, sm] = sp.split(':').map(Number);
  const [uh, um] = [date.getUTCHours(), date.getUTCMinutes()];
  let diff = sh*60+sm - (uh*60+um);
  if (diff > 720) diff -= 1440;
  else if (diff < -720) diff += 1440;
  return diff/60;
}

function definirFechasFiltrado() {
  const now = new Date();
  const off = getSpainOffsetHours(now);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6 - off));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  console.log('Rango: ', start.toISOString(), '→', end.toISOString());
  return { start, end };
}

function normalizarParsed(parsed, url) {
  if (!parsed?.tv) return parsed;

  const progs = [];

  // Si hay <programme> fuera de <tv>
  for (const key in parsed) {
    if (key !== 'tv' && parsed[key]?.programme) {
      progs.push(...parsed[key].programme);
      delete parsed[key].programme;
    }
  }

  // Y si hay programmes dentro de channels
  if (Array.isArray(parsed.tv.channel)) {
    parsed.tv.channel.forEach(ch => {
      if (Array.isArray(ch.programme)) {
        progs.push(...ch.programme);
        delete ch.programme;
      }
    });
  }

  parsed.tv.programme = parsed.tv.programme || [];
  parsed.tv.programme.push(...progs);

  console.log(`Normalizado xml de ${url}, total programmes: ${parsed.tv.programme.length}`);
  return parsed;
}

async function fetchXMLFromSources() {
  const { start, end } = definirFechasFiltrado();

  const xmls = await Promise.all(fuentesXML.map(async ({ url, comprimido }) => {
    console.log('Descargando:', url);
    try {
      const res = await axios.get(url, { responseType: 'arraybuffer' });
      const raw = Buffer.from(res.data);
      const xml = comprimido ? await (new Promise((res, rej) => {
        zlib.gunzip(raw, (e, d) => e ? rej(e) : res(d.toString()));
      })) : raw.toString();

      const parsed = await xml2js.parseStringPromise(xml, { trim: true, strict: false });
      return normalizarParsed(parsed, url);

    } catch (err) {
      console.error('Error fuente', url, err.message);
      return null;
    }
  }));

  const canalesPermitidos = ['DW en Español', 'RTPi', /* otros... */];
  const allProg = xmls.flatMap(p => p?.tv?.programme || []);

  console.log('Total programas recogidos:', allProg.length);

  const filt = allProg.filter(p => {
    try {
      const ini = parseStartDate(p.$.start);
      const fin = parseStartDate(p.$.stop);
      return ini < end && fin > start && canalesPermitidos.includes(p.$.channel);
    } catch {
      return false;
    }
  });

  console.log('Programas tras filtrar:', filt.length);

  const out = filt.map(p => ({
    $: { channel: p.$.channel, start: p.$.start, stop: p.$.stop },
    title: p.title?.[0]?._ || p.title?.[0] || '',
    desc: p.desc?.[0]?._ || p.desc?.[0] || '',
    icon: p.icon?.[0]?.$?.src ? { $: { src: p.icon[0].$.src } } : undefined
  }));

  const xmlFinal = builder.buildObject({ tv: { programme: out } });
  fs.writeFileSync('programacion-filtrada.xml', xmlFinal);
  console.log('Archivo final generado, programas:', out.length);
}

fetchXMLFromSources();

