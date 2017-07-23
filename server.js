var request = require("request")
var cheerio = require('cheerio');
var async = require('async');
var _ = require("lodash");
var firebase = require("firebase")
var bodyParser = require('body-parser');
var schedule = require('node-schedule');
var lassoImage = require('lasso-image');

// call the packages we need
var express = require('express');        // call express
var app = express();                 // define our app using express

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

var port = process.env.PORT || 8080;        // set our port

const categoryNames = ["Now Playing", "Coming Soon", "Watch Now", "All Films"]

var dataChanged, serverData;
var noPageFilms = []

// Init firebase
var config = {
    apiKey: "AIzaSyBYVxgzeUKQJS7P9vKDV7cfDNXt0DOEwiU",
    authDomain: "a24-app.firebaseapp.com",
    databaseURL: "https://a24-app.firebaseio.com",
    projectId: "a24-app",
    storageBucket: "a24-app.appspot.com",
    messagingSenderId: "447325235806"
};
firebase.initializeApp(config);

firebase.database().ref(`/dataChanged`)
    .once('value').then(snapshot => {
        dataChanged = snapshot.val();
    });

firebase.database().ref(`/data`)
    .once('value').then(snapshot => {
        serverData = snapshot.val();
    });

var router = express.Router();

router.get('/getImageDetails', (req, res) => {

    var img = new Image();
    img.onload = function() {
        console.log(this.width + 'x' + this.height);

        res.send({'response': 'ok!'});
    }

    img.src = 'https://s-media-cache-ak0.pinimg.com/736x/4d/d2/e1/4dd2e10df65ee3e72d548cc7f8fc99ac--superman-vs-batman-dawn-of-justice.jpg';
});

router.get('/parseFilmInfo', (req, res) => {

    var iterator = 0

    request('https://a24films.com/films', function (error, response, html) {
        if (!error && response.statusCode == 200) {

            var sections = [];
            var list = []

            var $ = cheerio.load(html)

            $('main.films').find('div.grid.media-tiles').each((i, elem) => {

                var movies = []

                $(elem).find('div.media-tile').each((j, emnt) => {

                    var credits = [];
                    var tile = cheerio.load($(emnt).html())

                    tile('figure').find('.overlay-data-group.credit').each((i, cred) => {
                        var obj = cheerio.load(tile(cred).html())
                        credits.push({
                            credit: obj('h4').text(),
                            content: obj('.datum').text().replace(/(\r\n|\n|\r)/gm, "").replace(/ +(?= )/g, '')
                        })
                    });

                    movies.push({
                        title: tile('h3').text(),
                        link: tile('a').attr('href'),
                        thumbNail: tile('img').attr('src'),
                        releaseDate: tile('time').attr('datetime') ? tile('time').attr('datetime').slice(0, 10) : tile('time').attr('datetime'),
                        credits: credits
                    })

                })

                list.push(movies)

            });

            async.map(list, (group, callback) => {

                console.log(group.length)

                async.map(group, (element, callback) => {

                    if (element.link === undefined){
                        return callback(null, clean(element))
                    }

                    var options = {
                        method: 'POST',
                        url: 'http://localhost:8080/parse-film',
                        body: { url: element.link },
                        json: true
                    };

                    request(options, function (error, response, html) {
                        if (error) return callback(error)

                        html.preview = element;

                        return callback(null, html)
                    })

                }, (error, result) => {
                    if (error)
                        callback({ error: "Some error 1" })
                    else {

                        var categories = {};
                        categories.category = categoryNames[iterator]
                        categories.films = result

                        iterator++;

                        callback(null, categories)
                    }
                });

            }, (error, data) => {
                if (error)
                    res.json({ error: "Some error 2" })
                else {

                    // data[0].noPageFilms = noPageFilms;

                    firebase.database().ref(`/data`)
                        .set(data)
                        .then(() => {
                            console.log(data)
                            res.send(data)
                        });
                }
            })

        }
    });

})

router.post('/parse-film', (req, res) => {

    var url = req.body.url

    console.log(url)

    request(url, function (error, response, html) {
        if (!error && response.statusCode == 200) {

            var film = {}
            film.mainMedia = []
            film.videos = []
            film.credits = []
            film.otherMedia = [];
            film.instagram = [];
            film.headlines = [];
            film.reviews = [];
            film.websites = [];
            film.social = [];
            film.watchNow = [];

            var $ = cheerio.load(html)

            film.title = $('h1.title').text()
            film.synopsis = $('div.synopsis.text-content p').text()

            $('li.slide', 'ul.slides').each((i, elem) => {
                var obj = cheerio.load($(elem).html())
                film.mainMedia.push({
                    imgURL: obj('img').attr('src'),
                    imgWidth: obj('img').attr('data-width'),
                    imgHeight: obj('img').attr('data-height'),
                    gifURL: obj('li.still').attr('data-image'),
                    videoID: $('li.slide').attr('data-video-id')
                })
            });

            $('ul.slides').find('li.slide.video').each((i, elem) => {
                film.videos.push({
                    videoID: $(elem).attr('data-video-id')
                })
            });

            $('.credit', '.credits').each((i, elem) => {
                var obj = cheerio.load($(elem).html())
                film.credits.push({
                    credit: obj('h3').text(),
                    content: obj('.content').text().replace(/(\r\n|\n|\r)/gm, "").replace(/ +(?= )/g, ''),
                })
            });

            $('figure', '.block.film-media-block.image').each((i, elem) => {
                var obj = cheerio.load($(elem).html())
                film.otherMedia.push({
                    image: obj('img').attr('src'),
                    caption: obj('p').text()
                })
            });

            $('figure', '.block.film-media-block.instagram ').each((i, elem) => {
                var obj = cheerio.load($(elem).html())
                film.instagram.push({
                    handle: obj('a').attr('href'),
                    media: obj('img').attr('src'),
                    caption: obj('p').text()
                })
            });

            $('.headline-container', '.block.film-media-block.headline ').each((i, elem) => {
                var obj = cheerio.load($(elem).html())
                film.headlines.push({
                    link: obj('.headline-attribution a').attr('href'),
                    title: obj('.headline-attribution a').attr('title'),
                    source: obj('.headline-attribution a').text(),
                    summary: obj('.headline-summary').text().replace(/(\r\n|\n|\r)/gm, "").replace(/ +(?= )/g, ''),
                    image: obj('.headline-image img').attr('src')
                })
            });

            $('.review-container', '.block.film-media-block.review ').each((i, elem) => {
                var obj = cheerio.load($(elem).html())
                film.reviews.push({
                    link: obj('.review-attribution a').attr('href'),
                    title: obj('.review-attribution a').attr('title'),
                    source: obj('.review-attribution a').text().replace(/(\r\n|\n|\r)/gm, "").replace(/ +(?= )/g, ''),
                    summary: obj('.review-summary').text().replace(/(\r\n|\n|\r)/gm, "").replace(/ +(?= )/g, ''),
                    image: obj('.review-image img').attr('src')
                })
            });

            $('.block-content', '.block.film-media-block.website ').each((i, elem) => {
                var obj = cheerio.load($(elem).html())
                film.websites.push({
                    link: obj('a').attr('href'),
                    image: obj('img').attr('src')
                })
            });

            $('li', 'ul.links').each((i, elem) => {
                var obj = cheerio.load($(elem).html())
                film.social.push({
                    type: obj('a').attr('title'),
                    link: obj('a').attr('href')
                })
            });

            $('li.source', 'ul.watch-now-links').each((i, elem) => {
                var obj = cheerio.load($(elem).html())
                film.watchNow.push({
                    type: obj('a').attr('title'),
                    link: obj('a').attr('href')
                })
            });

            console.log('Ready to send: ', film.title)

            res.send(clean(film))
        }
    });
})

/**
 * Removes empty properties from an object
 * @param {*} obj 
 */
function clean(obj) {
  var propNames = Object.getOwnPropertyNames(obj);
  for (var i = 0; i < propNames.length; i++) {
    var propName = propNames[i];
    if (obj[propName] === null || obj[propName] === undefined || obj[propName].length === 0) {
      delete obj[propName];
    }
  }
  return obj
}

var j = schedule.scheduleJob('7 * * * *', function(){
  console.log('The answer to life, the universe, and everything!');
});

app.use('/', router);

app.listen(port);
console.log('Magic happens on port ' + port);