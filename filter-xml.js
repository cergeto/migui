const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const zlib = require('zlib');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

// URL del archivo comprimido con los iconos
const urlXMLIconos = 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv_sincolor2.xml.gz';
const fechaHoy = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'

// Función para realizar la solicitud HTTP de forma anónima
async function fetchXML() {
  try {
    // Realizamos la solicitud sin enviar información que identifique al cliente
    const responseXMLIconos = await axios.get(urlXMLIconos, {
      responseType: 'arraybuffer', // Indicamos que recibimos datos binarios (archivo comprimido)
      headers: {
        // Eliminamos o modificamos las cabeceras para evitar rastreo
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36', // Cambiar a un User-Agent genérico o vacío
        'Referer': '', // Eliminar el referer para evitar que el servidor sepa de dónde proviene la solicitud
        'Origin': '', // Eliminar la cabecera Origin para evitar rastreo de origen
        'X-Forwarded-For': '', // Eliminar la cabecera X-Forwarded-For si se usa en tu caso
        'Connection': 'keep-alive', // Mantener la conexión abierta (no es estrictamente necesario, pero evita sobrecargar el servidor)
        'Accept-Encoding': 'gzip, deflate, br', // Aseguramos que los datos se compriman, si se requiere
        'Accept': 'application/xml', // Aceptamos respuestas en formato XML
      }
    });

    // Descomprimir y procesar el XML en streaming
    const xmlIconosData = await decompressXML(responseXMLIconos.data);

    // Procesamos el XML descomprimido
    parseXML(xmlIconosData);
  } catch (error) {
    console.error('Error al obtener el archivo XML comprimido:', error);
  }
}

// Función para descomprimir el archivo .gz
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

// Función para parsear el XML
function parseXML(xmlIconosData) {
  xml2js.parseString(xmlIconosData, { trim: true }, (errIconos, resultIconos) => {
    if (errIconos) {
      console.error('Error al parsear el XML de iconos:', errIconos);
      return;
    }

    // Procesamos el XML
    const hoy0600 = new Date(fechaHoy + 'T06:00:00'); // Hoy a las 06:00
    const manana0600 = new Date(hoy0600); // Copiar la fecha de hoy a las 06:00
    manana0600.setDate(hoy0600.getDate() + 1); // Sumar 1 día para obtener mañana a las 06:00

    const programasFiltrados = resultIconos.tv.programme
      .filter(p => {
        const startDate = p.$.start;
        const startDateTime = parseStartDate(startDate);
        return startDateTime >= hoy0600 && startDateTime < manana0600;
      })
      .filter(p => ['La 1 HD', 'La 2'].includes(p.$.channel));

    const programasJSON = programasFiltrados.map(p => {
      const icono = p.icon && p.icon.length > 0 ? p.icon[0].$.src : null;
      const subTitle = p['sub-title'] && p['sub-title'].length > 0 ? p['sub-title'][0]._ : null;
      const title = p.title && p.title.length > 0 ? p.title[0]._ : '';
      const desc = p.desc && p.desc.length > 0 ? p.desc[0]._ : '';

      return {
        channel: p.$.channel,
        start: p.$.start,
        stop: p.$.stop,
        title: title,
        subTitle: subTitle,
        desc: desc,
        icon: icono ? icono : null,
      };
    });

    console.log('Programas filtrados:', programasJSON);

    // Guarda el JSON minimizado en un archivo
    fs.writeFileSync('./programacion-hoy.json', JSON.stringify(programasJSON));
    console.log('Archivo JSON creado correctamente');
  });
}

// Convierte la fecha del formato 'YYYYMMDDhhmmss +TZ' a un objeto Date
function parseStartDate(startDate) {
  const dateStr = startDate.slice(0, 8);
  const timeStr = startDate.slice(8, 14);
  const tzStr = startDate.slice(14);
  const formattedDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(4, 6)}${tzStr}`;
  return new Date(formattedDate);
}

// Ejecutar el proceso
fetchXML();
