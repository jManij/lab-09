'Use strict'

//Dependencies
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');


//Global vars
const PORT = process.env.PORT || 3001;
const ROUTE_IDs = ['LOCATION', 'WEATHER', 'EVENTS', 'MOVIES', 'YELP'];
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', error => {
  console.error(error);
})

//Apps
const app = express();
app.use(cors());


//Routes
app.get('/location', searchToLatLng);
app.get('/weather', searchWeather);
app.get('/events', searchEvents);
// app.get('/movies', searchMovies);
// app.get('/yelp', searchFromYelp);
app.use('*', (req, res) => {
  res.send('You got in the wrong place')
})


/******************-----CONSTRUCTOR--------**************************/

function FormattedLocation(query, data) {
  this.search_query = query;
  this.formatted_query = data.results[0].formatted_address;
  this.latitude = data.results[0].geometry.location.lat;
  this.longitude = data.results[0].geometry.location.lng
}

function FormattedDailyWeather(data) {
  this.forecast = data.summary;
  this.time = new Date(data.time * 1000).toDateString();
}

function FormattedEvent(data) {
  this.name = data.name.text;
  this.link = data.url;
  this.event_date = new Date(data.start.local).toDateString();
  this.summary = data.description.text;
}

function FormattedMovies(data) {
  this.title = data.original_title;
  this.overview = data.overview;
  this.average_votes = data.vote_average;
  this.total_votes = data.vote_count;
  this.image_url = `https://image.tmdb.org/t/p/w200_and_h300_bestv2${data.poster_path}`;
  this.popularity = data.popularity;
  this.released_on = data.release_date;
}
/******************-----CONSTRUCTOR--------**************************/

/******************---ROUTES--------**************************/
function searchToLatLng(request, response) {
  let locationName = request.query.data || 'seattle';
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${locationName}&key=${process.env.GEOCODE_API_KEY}`;

  getLocation(locationName, response, url); //Get location

}


function searchWeather(request, response) {
  let locationName = request.query.data.search_query;
  let location_id = request.query.data.id;
  console.log(request.query.data);
  console.log('search weather location id: ', location_id);
  let lat = request.query.data.latitude;
  let long = request.query.data.longitude;
  let weatherLocation = `${lat},${long}` || '37.8267,-122.4233';
  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${weatherLocation}`;

  checkDB('location_id', location_id, 'weather', url, response)
    .then(data => {
      response.send(data);
    })

}

function searchEvents(request, response) {
  let lat = request.query.data.latitude;
  let long = request.query.data.longitude;
  const url = `https://www.eventbriteapi.com/v3/events/search/?token=${process.env.EVENTBRITE_API_KEY}&location.latitude=${lat}&location.longitude=${long}`
  superagent.get(url)
    .then(result => {
      let arrayOfFormattedEvents = result.body.events.map(item => {
        return new FormattedEvent(item);
      })

      response.send(arrayOfFormattedEvents);

    }).catch(e => {
      console.log(e);
      response.status(500).send('Status 500');
    })
}

function searchMovies(request, response) {
  const movieName = request.query.data.search_query;
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIE_API_KEY}&language=en-US&page=1&include_adult=false&query=${movieName}`
  getSuperAgent(url, response, ROUTE_IDs.MOVIES);
}


//Returns false or sends from here
function checkDB(search_query, search_value, tableName, url, routeID, response) {
  console.log('Check DB: ', search_value);

  return client.query(`SELECT * FROM ${tableName} WHERE ${search_query}=$1`, [search_value])
    .then(sqlResult => {
      if (sqlResult.rowCount === 0) {
        return makeApiCALL(tableName, search_value, url);
      } else {
        return sendFromDB(sqlResult);
      }
    })
}

const SQL_INSERTS = {
  locations: `INSERT INTO locations(
    latitude,
    longitude,
    search_query,
    formatted_query
    
  ) VALUES($1, $2, $3, $4)
                RETURNING *`,
  weather: `INSERT INTO weather(
    forecast,
    time,
    location_id) VALUES($1, $2, $3)`
}

function sendFromDB(sqlResult) {
  console.log('returning from DB');
  console.log(sqlResult.rows);
  return sqlResult.rows;
}

function makeApiCALL(tableName, search_value, url) {
  console.log('Make api call');

  switch (tableName) {
  case 'weather':
    return superagent.get(url)
      .then(result => {
      // console.log(result.body);
        let forecastArr = result.body.daily.data.map(el => {
          return new FormattedDailyWeather(el);
        })
        console.log(forecastArr);
        forecastArr.forEach(item => {
          return client.query(
            SQL_INSERTS[tableName], [item.forecast, item.time, search_value]
          ).then(sqlResult => {
            return sqlResult.rows;
          })

        })

      })

    // case 'movies':
    //   return superagent.get(url) 
    //     .then(result => {

    //     })

  }//switch ends


}






/******************---ROUTES--------**************************/


/******************---HELPER FUNCTIONS--------**************************/


function getLocation(locationName, response, url) {
  client.query(`SELECT * FROM locations WHERE search_query=$1`, [locationName])
    .then(sqlResult => {

      if (sqlResult.rowCount === 0) {
        console.log('getting new data from googles');
        superagent.get(url)
          .then(result => {

            let location = new FormattedLocation(locationName, result.body)
            client.query(
              `INSERT INTO locations (
          search_query,
          formatted_query,
          latitude,
          longitude
        ) VALUES ($1, $2, $3, $4)`,
              [location.search_query, location.formatted_query, location.latitude, location.longitude]
            )
            response.send(location);

          }).catch(e => {
            console.error(e);
            response.status(500).send('Status 500: So sorry i broke');
          })
      } else {
        console.log('sending from db');
        // send the frontend what was in the db
        response.send(sqlResult.rows[0]);
      }
    });
}

/******************---HELPER FUNCTIONS--------**************************/


//Starting Server
app.listen(PORT, () => {
  console.log('listing on port', PORT);
})
