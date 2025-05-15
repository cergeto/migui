const axios = require('axios');
const fs = require('fs');
const zlib = require('zlib');
const sax = require('sax'); // Importa sax para procesar el XML de manera eficiente
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

// URL del archivo comprimido con los iconos
const urlXMLIconos = 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv_sincolor2.xml.gz';
const fechaHoy = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'

// Procesamiento del archivo comprimido y parseo en streaming
async function fetchAndProcessXML() {
  try {
    // Obtener el archivo comprimido con los iconos
    const responseXMLIconos = await axios.get(urlXMLIconos, { responseType: 'stream' });

    // Procesar el archivo de manera eficiente utilizando SAX
    await processXMLStream(responseXMLIconos.data);

  } catch (error) {
    console.error('Error al obtener el archivo XML comprimido:', error);
  }
}

// Procesar el archivo en streaming usando SAX
async function processXMLStream(compressedData) {
  // Creamos el stream de descompresión
  const gunzip = zlib.createGunzip();
  const xmlStream = compressedData.pipe(gunzip); // Descomprimimos el archivo en el mismo flujo

  // Creamos un parser SAX
  const parser = sax.createStream(true, { trim: true });

  // Variables de estado para almacenar los datos
  let currentProgram = null;
  let programasFiltrados = [];

  // Enlace del evento 'onopentag' que captura las etiquetas de apertura del XML
  parser.on('opentag', function (node) {
    if (node.name === 'programme') {
      currentProgram = {
        channel: node.attributes.channel,
        start: node.attributes.start,
        stop: node.attributes.stop,
        title: '',
        subTitle: '',
        desc: '',
        icon: ''
      };
    }
    if (node.name === 'title' && currentProgram) {
      currentProgram.title = ''; // Vaciar título para añadir contenido
    }
    if (node.name === 'sub-title' && currentProgram) {
      currentProgram.subTitle = ''; // Vaciar sub-título
    }
    if (node.name === 'desc' && currentProgram) {
      currentProgram.desc = ''; // Vaciar descripción
    }
    if (node.name === 'icon' && currentProgram) {
      currentProgram.icon = ''; // Vaciar icono
    }
  });

  // Evento cuando se encuentra contenido en una etiqueta
  parser.on('text', function (text) {
    if (currentProgram) {
      if (currentProgram.title === '') {
        currentProgram.title = text.trim();
      } else if (currentProgram.subTitle === '') {
        currentProgram.subTitle = text.trim();
      } else if (currentProgram.desc === '') {
        currentProgram.desc = text.trim();
      } else if (currentProgram.icon === '') {
        currentProgram.icon = text.trim();
      }
    }
  });

  // Evento cuando se cierra una etiqueta
  parser.on('closetag', function (tagName) {
    if (tagName === 'programme' && currentProgram) {
      // Filtrar solo los programas de hoy y los canales deseados
      const startDate = parseStartDate(currentProgram.start);
      if (startDate.toISOString().split('T')[0] === fechaHoy && ['La 1 HD', 'La 2', 'Antena 3 HD', 'Cuatro HD', 'Telecinco HD', 'La Sexta HD'].includes(currentProgram.channel)) {
        programasFiltrados.push({
          channel: currentProgram.channel,
          start: currentProgram.start.slice(0, 14),
          stop: currentProgram.stop.slice(0, 14),
          title: currentProgram.title,
          subTitle: currentProgram.subTitle,
          desc: currentProgram.desc,
          icon: currentProgram.icon
        });
      }
      currentProgram = null; // Resetear el programa actual
    }
  });

  // Evento para errores de parseo
  parser.on('error', function (err) {
    console.error('Error al procesar el XML:', err);
  });

  // Procesar el archivo XML en flujo
  await pipeline(xmlStream, parser);

  // Verifica que se están obteniendo los datos esperados
  console.log('Programas filtrados:', programasFiltrados);

  // Guardar el archivo JSON con los programas filtrados de forma minimizada
  fs.writeFileSync('./programacion-hoy.json', JSON.stringify(programasFiltrados)); // Sin espacios ni saltos de línea
  console.log('Archivo JSON minimizado creado correctamente');
}

// Convierte la fecha en formato 'YYYYMMDDhhmmss +TZ' a un objeto Date
function parseStartDate(startDate) {
  const dateStr = startDate.slice(0, 8); // YYYYMMDD
  const timeStr = startDate.slice(8, 14); // hhmmss
  const formattedDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(4, 6)}`;
  return new Date(formattedDate); // Retorna un objeto Date
}

// Ejecutar el proceso
fetchAndProcessXML();
