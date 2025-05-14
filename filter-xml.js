const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');

// Configura aquí los canales que te interesan
const canalesInteresados = ['La 1', 'La 2', 'Antena 3'];

const urlXML = 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/refs/heads/master/tiviepg.xml';
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
        const startDate = p.$.start;
        const startDateTime = new Date(startDate.slice(0, 4), startDate.slice(4, 6) - 1, startDate.slice(6, 8)); // Convierte a Date
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

    // Guarda el JSON filtrado en un archivo
    fs.writeFileSync('./programacion-hoy.json', JSON.stringify(programasJSON, null, 2));
    console.log('Archivo JSON creado correctamente');
  });
}

// Ejecutar el proceso
fetchXML();
