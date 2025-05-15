const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const zlib = require('zlib'); // Para descomprimir el archivo .gz
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

// URL del archivo comprimido con la programación y los iconos
const urlXMLIconos = 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv_sincolor2.xml.gz';
const fechaHoy = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'

// Usar un parser SAX para evitar cargar el XML completo en memoria
const sax = require('sax');

async function fetchXML() {
  try {
    // Obtener el archivo comprimido con los iconos
    const responseXMLIconos = await axios.get(urlXMLIconos, { responseType: 'arraybuffer' });

    // Descomprimir y procesar el XML en streaming
    const xmlIconosData = await decompressXML(responseXMLIconos.data);

    // Procesamos el XML descomprimido con SAX (streaming)
    parseXMLStream(xmlIconosData);
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

function parseXMLStream(xmlIconosData) {
  // Usamos el parser SAX para procesar el XML en streaming
  const parser = sax.createStream(true, { trim: true });
  
  let programasFiltrados = [];
  
  parser.on('opentag', function (node) {
    if (node.name === 'programme') {
      const startDate = node.attributes.start; // Fecha en formato YYYYMMDDhhmmss +TZ
      const startDateTime = parseStartDate(startDate); // Convertir a Date
      
      if (startDateTime.toISOString().split('T')[0] === fechaHoy) {
        // Filtramos el canal dentro de los programas
        if (['La 1 HD', 'Cuatro HD', 'Antena 3 HD'].includes(node.attributes.channel)) {
          programasFiltrados.push({
            channel: node.attributes.channel,
            start: node.attributes.start.slice(0, 14),
            stop: node.attributes.stop.slice(0, 14),
            title: '',
            subTitle: '',
            desc: '',
            icon: ''
          });
        }
      }
    }

    if (node.name === 'title') {
      // Asumimos que el título sigue inmediatamente después de <title>
      programasFiltrados[programasFiltrados.length - 1].title = node.text;
    }

    if (node.name === 'sub-title') {
      programasFiltrados[programasFiltrados.length - 1].subTitle = node.text || null;
    }

    if (node.name === 'desc') {
      programasFiltrados[programasFiltrados.length - 1].desc = node.text || null;
    }

    if (node.name === 'icon') {
      programasFiltrados[programasFiltrados.length - 1].icon = node.attributes.src || null;
    }
  });

  parser.on('end', function () {
    // Al terminar de procesar el archivo, guardar el JSON
    console.log('Programas filtrados:', programasFiltrados);

    // Escribir el archivo al final de todo el proceso
    fs.writeFileSync('./programacion-hoy.json', JSON.stringify(programasFiltrados, null, 2));
    console.log('Archivo JSON creado correctamente');
  });

  // Iniciar el parsing
  parser.write(xmlIconosData);
  parser.end();
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
