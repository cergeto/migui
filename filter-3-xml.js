const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false } });

const urlXML = 'https://raw.githubusercontent.com/dvds1151/AR-TV/main/epg/artv-guide.xml';

const canalesPermitidos = ['Atrescine.es', 'RTenEspanol.ru'];

// Funciones auxiliares (horario, fechas, parseo de fechas)
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

  return { hoy0600, manana0600 };
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

// Función principal
async function fetchXML() {
  try {
    const response = await axios.get(urlXML, {
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/xml',
      }
    });

    const xmlData = response.data;

    xml2js.parseString(xmlData, { trim: true }, (err, result) => {
      if (err) {
        console.error('❌ Error al parsear XML:', err);
        return;
      }

      const { hoy0600, manana0600 } = definirFechasFiltrado();

      const programasFiltrados = result.tv.programme
        .filter(p => {
          const startDateTime = parseStartDate(p.$.start);
          const endDateTime = parseStartDate(p.$.stop);
          return (
            canalesPermitidos.includes(p.$.channel) &&
            endDateTime > hoy0600 &&
            startDateTime < manana0600
          );
        });

      const programasXML = programasFiltrados.map(p => ({
        $: { channel: p.$.channel, start: p.$.start, stop: p.$.stop },
        title: p.title?.[0] || '',
        'sub-title': p['sub-title']?.[0] || '',
        desc: p.desc?.[0] || '',
        category: p.category?.[0] || '',
        icon: p.image?.[0] ? { $: { src: p.image[0] } } : undefined
      }));

      const xmlFinal = builder.buildObject({ tv: { programme: programasXML } });
      fs.writeFileSync('./programacion-3-hoy.xml', xmlFinal);
      console.log('✅ Archivo XML creado correctamente.');
    });

  } catch (error) {
    console.error('❌ Error al obtener el XML:', error.message);
  }
}

// Ejecutar
fetchXML();
