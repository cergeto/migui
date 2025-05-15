const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');

// Configura aquí los canales que te interesan
const canalesInteresados = ['La 1 HD', 'La 2', 'Antena 3 HD'];

const urlXML = 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv.xml';
const fechaHoy = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'

async function fetchXML() {
  try {
    const response = await axios.get(urlXML);
    const xmlData = response.data;
    parseXML(xmlData);
  } catch (error) {
    console.error('Error al obtener el archivo XML:', error);
  }
}

function parseXML(xmlData) {
  xml2js.parseString(xmlData, { trim: true }, (err, result) => {
    if (err) {
      console.error('Error al parsear el XML:', err);
      return;
    }

    // Filtra los programas
    const programasFiltrados = result.tv.programme
      .filter(p => {
        const startDate = p.$.start; // Fecha en formato YYYYMMDDhhmmss +TZ
        const startDateTime = parseStartDate(startDate); // Convertir a Date
        return startDateTime.toISOString().split('T')[0] === fechaHoy; // Solo los programas de hoy
      })
      .filter(p => canalesInteresados.includes(p.$.channel)); // Filtra los canales que te interesan

    // Convierte los programas a JSON
    const programasJSON = programasFiltrados.map(p => ({
      channel: p.$.channel,
      start: p.$.start,
      stop: p.$.stop,
      title: p.title[0],
      desc: p.desc[0],
    }));

    // Verifica que se están obteniendo los datos esperados
    console.log('Programas filtrados:', programasJSON);
    
    // Guarda el JSON filtrado en un archivo
    fs.writeFileSync('./programacion-hoy.json', JSON.stringify(programasJSON, null, 2));
    console.log('Archivo JSON creado correctamente');
  });
}

// Convierte la fecha del formato 'YYYYMMDDhhmmss +TZ' a un objeto Date
function parseStartDate(startDate) {
  const dateStr = startDate.slice(0, 8); // YYYYMMDD
  const timeStr = startDate.slice(8, 14); // hhmmss
  const timezone = startDate.slice(15); // +0000 (zona horaria)
  
  // Crear una cadena de fecha con formato ISO
  const formattedDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(4, 6)}${timezone}`;
  
  return new Date(formattedDate); // Retorna un objeto Date
}

// Ejecutar el proceso
fetchXML();
