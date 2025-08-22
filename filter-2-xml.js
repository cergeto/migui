const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');

const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false } });

const urlXML = 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/tiviepg.xml';

// Lista de canales que deseas filtrar
const canalesPermitidos = [
  'RTPi'
];

// Obtener offset horario de España
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

// Rango de hoy 06:00 a mañana 06:00 (hora España)
function definirFechasFiltrado() {
  const ahora = new Date();
  const offsetHoras = getSpainOffsetHours(ahora);
  const hoy0600 = new Date(Date.UTC(
    ahora.getUTCFullYear(),
    ahora.getUTCMonth(),
    ahora.getUTCDate(),
    6 - offsetHoras, 0, 0
  ));
  const manana0600 = new Date(hoy0600);
  manana0600.setUTCDate(manana0600.getUTCDate() + 1);
  return { hoy0600, manana0600 };
}

// Convertir formato XMLTV a objeto Date UTC
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

  if (offsetSign === '+') date.setMinutes(date.getMinutes() - totalOffset);
  else if (offsetSign === '-') date.setMinutes(date.getMinutes() + totalOffset);

  return date;
}

// Obtener y procesar el XML
async function procesarXML() {
  try {
    const response = await axios.get(urlXML, {
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/xml'
      }
    });

    const xmlData = response.data;
    const parsed = await xml2js.parseStringPromise(xmlData, { trim: true });

    const { hoy0600, manana0600 } = definirFechasFiltrado();
    const programas = [];

    // Revisamos los <programme> dentro de <tv>
    if (Array.isArray(parsed.tv.programme)) {
      programas.push(...parsed.tv.programme);
    }

    // Revisamos los <programme> dentro de cada <channel>
    if (Array.isArray(parsed.tv.channel)) {
      parsed.tv.channel.forEach(channel => {
        if (Array.isArray(channel.programme)) {
          programas.push(...channel.programme);
        }
      });
    }

    const filtrados = programas.filter(p => {
      if (!p.$?.start || !p.$?.stop || !p.$?.channel) return false;
      const inicio = parseStartDate(p.$.start);
      const fin = parseStartDate(p.$.stop);
      return (
        fin > hoy0600 &&
        inicio < manana0600 &&
        canalesPermitidos.includes(p.$.channel)
      );
    });

    const programasXML = filtrados.map(p => ({
      $: {
        channel: p.$.channel,
        start: p.$.start,
        stop: p.$.stop
      },
      title: p.title?.[0]?._ || p.title?.[0] || '',
      'sub-title': p['sub-title']?.[0]?._ || p['sub-title']?.[0] || '',
      desc: p.desc?.[0]?._ || p.desc?.[0] || '',
      category: p.category?.[0]?._ || p.category?.[0] || '',
      icon: p.icon?.[0]?.$?.src ? { $: { src: p.icon[0].$.src } } : undefined
    }));

    const xmlFinal = builder.buildObject({ tv: { programme: programasXML } });
    fs.writeFileSync('./programacion.2-hoy.xml', xmlFinal);

    console.log(`✅ Archivo creado: programacion-2-hoy.xml (${programasXML.length} programas)`);

  } catch (err) {
    console.error('❌ Error procesando el XML:', err.message);
  }
}

// Ejecutar
procesarXML();
