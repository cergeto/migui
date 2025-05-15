const axios = require('axios');
const fs = require('fs');
const zlib = require('zlib'); // Para descomprimir el archivo .gz
const xml2js = require('xml2js'); // Usaremos xml2js como antes
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

// URL del archivo comprimido con la programación y los iconos
const urlXMLIconos = 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv_sincolor2.xml.gz';
const fechaHoy = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'

async function fetchXML() {
  try {
    // Obtener el archivo comprimido con los iconos
    const responseXMLIconos = await axios.get(urlXMLIconos, { responseType: 'arraybuffer' });

    // Descomprimir y procesar el XML
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

    // Filtramos los programas de hoy directamente mientras parseamos el XML
    const programasFiltrados = resultIconos.tv.programme
      .filter(p => {
        const startDate = p.$.start; // Fecha en formato YYYYMMDDhhmmss +TZ
        const startDateTime = parseStartDate(startDate); // Convertir a Date
        return startDateTime.toISOString().split('T')[0] === fechaHoy; // Solo los programas de hoy
      })
      .filter(p => ['La 1 HD', 'Telecinco HD', 'Antena 3 HD'].includes(p.$.channel)); // Filtra los canales que te interesan

    // Convierte los programas a JSON sin la zona horaria
    const programasJSON = programasFiltrados.map(p => {
      // Buscar el icono correspondiente (si existe)
      const icono = p.icon && p.icon.length > 0 ? p.icon[0].$.src : null; // Aseguramos que accedemos a la URL del icono correctamente
      const subTitle = p['sub-title'] && p['sub-title'].length > 0 ? p['sub-title'][0] : null; // Extraemos el subtítulo si existe

      return {
        channel: p.$.channel,
        start: p.$.start.slice(0, 14), // Eliminamos la zona horaria
        stop: p.$.stop.slice(0, 14),   // Eliminamos la zona horaria
        title: p.title[0],
        subTitle: subTitle, // Agregamos el sub-título si existe
        desc: p.desc[0],
        icon: icono ? icono : null, // Agregamos el icono si existe
      };
    });

    // Verifica que se están obteniendo los datos esperados
    console.log('Programas filtrados:', programasJSON);

    // Guarda el JSON filtrado en un archivo
    // Escribir el archivo al final de todo el proceso
    fs.writeFileSync('./programacion-hoy.json', JSON.stringify(programasJSON, null, 2));
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
