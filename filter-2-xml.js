const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');

const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false } });
const urlXML = 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/tiviepg.xml';

// Definir los canales que quieres incluir
const canalesPermitidos = ['RTPi'];  // Ajusta según tus necesidades

function parseFecha(fecha) {
  const dt = fecha.slice(0, 14);
  const tz = fecha.slice(15).trim();
  const f = `${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}T${dt.slice(8,10)}:${dt.slice(10,12)}:${dt.slice(12,14)}Z`;
  const d = new Date(f);
  if (tz) {
    const sign = tz[0];
    const h = parseInt(tz.slice(1,3), 10);
    const m = parseInt(tz.slice(3,5), 10);
    const total = h*60 + m;
    sign === '+' ? d.setMinutes(d.getMinutes() - total) : d.setMinutes(d.getMinutes() + total);
  }
  return d;
}

function getSpainOffsetHours() {
  const now = new Date();
  const sp = now.toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour12: false, hour: '2-digit', minute: '2-digit' });
  const [sh, sm] = sp.split(':').map(Number);
  const [uh, um] = [now.getUTCHours(), now.getUTCMinutes()];
  let diff = (sh*60 + sm)-(uh*60 + um);
  if (diff > 720) diff -= 1440;
  else if (diff < -720) diff += 1440;
  return diff / 60;
}

function rangoFiltrado() {
  const now = new Date();
  const offset = getSpainOffsetHours();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6 - offset));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  console.log('Filtrando entre', start.toISOString(), 'y', end.toISOString());
  return { start, end };
}

async function procesar() {
  console.log('Descargando EPG de DobleM...');
  let xml;
  try {
    const res = await axios.get(urlXML, { responseType: 'text', headers: { 'Accept': 'application/xml' } });
    xml = res.data;
    console.log('Descargado. Tamaño:', xml.length);
  } catch (e) {
    console.error('Error de descarga:', e.message);
    return;
  }

  let parsed;
  try {
    parsed = await xml2js.parseStringPromise(xml, { trim: true, explicitArray: true });
    console.log('XML parseado.');
  } catch (e) {
    console.error('Error al parsear XML:', e.message);
    return;
  }

  if (!parsed.tv) {
    console.error('No se encontró <tv>');
    return;
  }

  const { start, end } = rangoFiltrado();
  const programas = [];

  if (parsed.tv.programme) programas.push(...parsed.tv.programme);

  if (parsed.tv.channel) {
    parsed.tv.channel.forEach(ch => {
      if (ch.programme) programas.push(...ch.programme);
    });
  }

  console.log('Total programas encontrados:', programas.length);

  const filtrados = programas.filter(p => {
    if (!p.$?.start || !p.$?.stop) return false;
    const ini = parseFecha(p.$.start);
    const fin = parseFecha(p.$.stop);
    if (!ini || !fin) return false;
    return fin > start && ini < end && canalesPermitidos.includes(p.$.channel);
  });

  console.log('Programas filtrados:', filtrados.length);

  const output = filtrados.map(p => ({
    $: { channel: p.$.channel, start: p.$.start, stop: p.$.stop },
    title: p.title?.[0]?._ || p.title?.[0] || '',
    desc: p.desc?.[0]?._ || p.desc?.[0] || '',
    category: p.category?.[0]?._ || p.category?.[0] || '',
    icon: p.icon?.[0]?.$?.src ? { $: { src: p.icon[0].$.src } } : undefined
  }));

  try {
    const xmlOut = builder.buildObject({ tv: { programme: output } });
    fs.writeFileSync('programacion-salida.xml', xmlOut);
    console.log('Archivo generado con éxito con', output.length, 'programas.');
  } catch (e) {
    console.error('Error generando archivo:', e.message);
  }
}

procesar();
