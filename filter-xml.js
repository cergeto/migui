const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const zlib = require('zlib'); // Para descomprimir el archivo .gz
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

// URL del archivo comprimido con los iconos
const urlXMLIconos = 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv_sincolor2.xml.gz';
const fechaHoy = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'

async function fetchXML() {
  try {
    // Obtener el archivo comprimido con los iconos
    const responseXMLIconos = await axios.get(urlXMLIconos, { responseType: 'arraybuffer' });

    // Descomprimir y procesar el XML en streaming
    const xmlIconosData = await decompressXML(responseXMLIconos.data);

    // Procesamos el XML descomprimido
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

    // Calcular las fechas de 06:00 de hoy y 06:00 de mañana
    const hoy0600 = new Date(fechaHoy + 'T06:00:00'); // Hoy a las 06:00
    const manana0600 = new Date(hoy0600); // Copiar la fecha de hoy a las 06:00
    manana0600.setDate(hoy0600.getDate() + 1); // Sumar 1 día para obtener mañana a las 06:00

    // Filtrar los programas que comienzan entre las 06:00 de hoy y las 06:00 de mañana
    const programasFiltrados = resultIconos.tv.programme
      .filter(p => {
        const startDate = p.$.start; // Fecha en formato YYYYMMDDhhmmss +TZ
        const startDateTime = parseStartDate(startDate); // Convertir a Date

        // Comprobar si la fecha está dentro del rango (desde las 06:00 de hoy hasta las 06:00 de mañana)
        return startDateTime >= hoy0600 && startDateTime < manana0600;
      })
      .filter(p => ['La 2', 'Telecinco HD', 'Antena 3 HD'].includes(p.$.channel)); // Filtra los canales que te interesan

    // Convierte los programas a JSON simplificado
    const programasJSON = programasFiltrados.map(p => {
      // Buscar el icono correspondiente (si existe)
      const icono = p.icon && p.icon.length > 0 ? p.icon[0].$.src : null; // Aseguramos que accedemos a la URL del icono correctamente
      const subTitle = p['sub-title'] && p['sub-title'].length > 0 ? p['sub-title'][0]._ : null; // Extraemos solo el texto del subtítulo
      const title = p.title && p.title.length > 0 ? p.title[0]._ : ''; // Extraemos solo el texto del título
      const desc = p.desc && p.desc.length > 0 ? p.desc[0]._ : ''; // Extraemos solo el texto de la descripción

      return {
        channel: p.$.channel,
        start: p.$.start.slice(0, 14), // Eliminamos la zona horaria
        stop: p.$.stop.slice(0, 14),   // Eliminamos la zona horaria
        title: title,
        subTitle: subTitle, // Agregamos el sub-título si existe
        desc: desc,
        icon: icono ? icono : null, // Agregamos el icono si existe
      };
    });

    // Verifica que se están obteniendo los datos esperados
    console.log('Programas filtrados:', programasJSON);

    // Guarda el JSON minimizado en un archivo
    fs.writeFileSync('./programacion-hoy.json', JSON.stringify(programasJSON)); // Sin 'null, 2' para minimizado
    console.log('Archivo JSON creado correctamente');
  });
}

// Convierte la fecha del formato 'YYYYMMDDhhmmss +TZ' a un objeto Date
function parseStartDate(startDate) {
  const dateStr = startDate.slice(0, 8); // YYYYMMDD
  const timeStr = startDate.slice(8, 14); // hhmmss
  // Eliminamos la zona horaria
  const formattedDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(4, 6)}`;
  
  return new Date(formattedDate); // Retorna un objeto Date sin zona horaria
}

// Ejecutar el proceso
fetchXML();
