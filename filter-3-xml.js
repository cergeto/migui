const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');

// Configuración
const sourceURL = 'https://raw.githubusercontent.com/dvds1151/AR-TV/main/epg/artv-guide.xml';
const canalesPermitidos = [
  'Atrescine.es',
  'RTenEspanol.ru'
];

const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false } });

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

// Definir rango horario
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

// Convertir fechas XMLTV a Date
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

// Procesar el XML
async function procesarXML() {
  try {
    const response = await axios.get(sourceURL);
    const xmlData = response.data;

    const parsed = await xml2js.parseStringPromise(xmlData, { trim: true });
    const { hoy0600, manana0600 } = definirFechasFiltrado();

    // Filtrar programas
    const programasFiltrados = parsed.tv.programme.filter(p => {
      const startDate = parseStartDate(p.$.start);
      const endDate = parseStartDate(p.$.stop);
      return (
        canalesPermitidos.includes(p.$.channel) &&
        endDate > hoy0600 &&
        startDate < manana0600
      );
    });

    // Filtrar canales (solo los que están en la lista permitida)
    const canalesFiltrados = (parsed.tv.channel || []).filter(canal =>
      canal.$ && canalesPermitidos.includes(canal.$.id)
    );

    // Construir XML final
    const xmlFinal = builder.buildObject({
      tv: {
        channel: canalesFiltrados,
        programme: programasFiltrados
      }
    });

    fs.writeFileSync('./programacion-3-hoy.xml', xmlFinal);
    console.log('✅ Archivo generado: atrescine-filtrado.xml');
  } catch (error) {
    console.error('❌ Error al procesar XML:', error.message);
  }
}

// Ejecutar
procesarXML();
