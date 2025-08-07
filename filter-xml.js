const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false } });
const zlib = require('zlib');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

const urlXMLIconos = 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv_sincolor2.xml.gz';

// Función para obtener el offset horario de España (Europe/Madrid) en horas
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

// Función para definir fechas de filtro hoy a las 06:00 y mañana a las 06:00 (en UTC ajustado a España)
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

  console.log('Offset horario España:', tzOffsetHoras);
  console.log('Hoy 06:00 (UTC):', hoy0600.toISOString());
  console.log('Mañana 06:00 (UTC):', manana0600.toISOString());

  return { hoy0600, manana0600 };
}

async function fetchXML() {
  try {
    const responseXMLIconos = await axios.get(urlXMLIconos, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': '',
        'Origin': '',
        'X-Forwarded-For': '',
        'Connection': 'keep-alive',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'application/xml',
      }
    });

    const xmlIconosData = await decompressXML(responseXMLIconos.data);
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

    const { hoy0600, manana0600 } = definirFechasFiltrado();

    const programasFiltrados = resultIconos.tv.programme
      .filter(p => {
        const startDateTime = parseStartDate(p.$.start);
        const endDateTime = parseStartDate(p.$.stop);
        return endDateTime > hoy0600 && startDateTime < manana0600;
      })
      .filter(p => 
        [
          'La 1 HD', 'La 2', 'Antena 3 HD', 'Cuatro HD', 'Telecinco HD', 'La Sexta HD', 'TRECE', 'El Toro TV', 'Mega', 'DMAX', 
          'DKISS', 'Ten', 'AMC Break', 'Discovery', 'BBC Top Gear', 'Canal Hollywood HD', 'Atrescine', 'Somos', 'AMC HD', 'TCM HD', 
          'AXN Movies HD', 'DARK', 'Sundance TV', 'Be Mad', 'XTRM', 'Paramount Network', 'Cine Feel Good', 'Runtime Cine y Series', 
          'Runtime Crimen', 'Runtime Acción', 'Runtime Thriller-Terror', 'Runtime Comedia', 'RunTime Clásicos', 'Runtime Romance', 
          'RunTime Familia', 'Pelis Top (Rakuten TV)', 'Acción (Rakuten TV)', 'Comedias (Rakuten TV)', 'Dramas (Rakuten TV)', 
          'Películas Románticas (Rakuten TV)', 'Cine Español (Rakuten TV)', 'Thrillers (Rakuten TV)', 'En Familia (Rakuten TV)', 
          'Energy', 'Divinity', 'Neox', 'Atreseries', 'Factoría de Ficción', 'Nova', 'Cosmo HD', 'STAR Channel HD', 'Warner TV HD', 
          'Calle 13 HD', 'AXN HD', 'SyFy HD', 'BBC Drama', 'Historia', 'Odisea', 'AMC Crime', 'National Geographic HD', 'Nat Geo Wild HD', 
          'Love the Planet', 'Love Wine', 'Historia y Vida', 'NatureTime', 'Iberalia TV', 'BuenViaje', 'Cazavisión', 'Teledeporte', 
          'GOL PLAY', 'Eurosport 1 HD', 'Eurosport 2', 'FIFA+', 'Real Madrid TV', 'Top Barça', 'Esport 3', 'Onetoro', 'LALIGA Inside', 
          'Red Bull TV (Rakuten TV)', 'Surf Channel', 'MyPadel TV', 'Motorvision TV', 'Canal Sur HD', 'Canal Sur Andalucía', 
          'Aragón TV', 'Aragón TV Internacional', 'TPA7 Asturias', 'TPA8 Asturias', 'À Punt', 'CMM TV', 'La 7 CyL', 'La 8 Valladolid', 
          'TV3', 'TV3CAT Catalunya', 'El 33 Catalunya', '324', 'SX3', 'Canal Extremadura', 'Canal Extremadura SAT', 'TVG Europa HD', 
          'IB3 TV Illes Balears', 'TV Canaria', 'Telemadrid', 'Telemadrid Internacional', 'La Otra', 'La 7 Murcia', 'Navarra TV', 'ETB1', 
          'ETB2', 'EITB Basque', 'Decasa', 'Canal Cocina', 'Vivir con perros', 'Vivir con gatos', 'Flamenco Auditorio', '24 Horas', 
          'EuroNews', 'Negocios TV', 'CNN en Español', 'Clan', 'Boing', 'Anime Visión', 'Anime Visión Classics', 'Disney Junior'
        ].includes(p.$.channel));

    const programasXML = programasFiltrados.map(p => ({
      $: { channel: p.$.channel, start: p.$.start, stop: p.$.stop },
      title: p.title && p.title.length > 0 ? p.title[0]._ : '',
      'sub-title': p['sub-title'] && p['sub-title'].length > 0 ? p['sub-title'][0]._ : '',
      desc: p.desc && p.desc.length > 0 ? p.desc[0]._ : '',
      icon: p.icon && p.icon.length > 0 ? { $: { src: p.icon[0].$.src } } : undefined
    }));

    const xmlMin = builder.buildObject({ tv: { programme: programasXML } });
    fs.writeFileSync('./programacion-hoy.xml', xmlMin);
    console.log('Archivo XML creado correctamente');
  });
}

// Convierte la fecha del formato 'YYYYMMDDhhmmss +TZ' a un objeto Date ajustado a UTC
function parseStartDate(startDate) {
  const dateTimePart = startDate.slice(0, 14);
  const tzPart = startDate.slice(15).trim();

  const formattedDate = `${dateTimePart.slice(0, 4)}-${dateTimePart.slice(4, 6)}-${dateTimePart.slice(6, 8)}T` +
                        `${dateTimePart.slice(8, 10)}:${dateTimePart.slice(10, 12)}:${dateTimePart.slice(12, 14)}`;

  // Creamos fecha en UTC
  const date = new Date(formattedDate + 'Z');

  // Ajustamos minutos según offset del XML (por ejemplo +0200)
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

// Ejecutar
fetchXML();
