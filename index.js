var express = require('express');
var app = express();
var fs = require("fs");
const { exec } = require("child_process");
const axios = require('axios');
const queryString = require('querystring');
app.use(express.json());

function zeroPad(num, places) {
    var zero = places - num.toString().length + 1;
    return Array(+(zero > 0 && zero)).join("0") + num;
}

app.get('/api', function (req, res) {
    if(req.query['t'] == 'caps') {
        res.sendFile(__dirname + "/" + "caps.xml")
    } else if(req.query['t'] == 'tvsearch' && req.query['tvmazeid']) {
        const url = 'https://api.tvmaze.com/shows/' + req.query['tvmazeid'];

        axios.get(url).then(showres => {
            axios.get(url+ '/episodes').then(episoderes => {
            const episodes = episoderes.data;
            for(const episode of episodes) {
                if(episode['number'] == req.query['ep'] && episode['season'] == req.query['season']) {
                    const sonarrNaming = `S${zeroPad(episode['season'], 2)}E${zeroPad(episode['number'], 2)}`
                    // found the one we are looking for
                    exec("get-iplayer --exclude-channel=CBBC --nocopyright --fields=name '" + showres.data['name'] +"'", (error, stdout, stderr) => {
                        if (error) {
                            res.sendFile(__dirname + "/" + "blanktvsearch.xml")
                        }
                        if (stderr) {
                            console.log(`stderr: ${stderr}`);
                            res.sendFile(__dirname + "/" + "blanktvsearch.xml")
                        }
                        if(stdout){
                            const resultregex = new RegExp(/^(\d*):\t(.*)\ \-\ (.*)\,\ (.*),\ (.*)/gm);
                            const matches = [...stdout.matchAll(resultregex)]
                            if(matches.length == 0) {
                                res.sendFile(__dirname + "/" + "blanktvsearch.xml")
                            } else {
                                for(const match of matches) {
                                    if(match[3] == episode.name) // matchgroup 3 is the episode title
                                    {
                                        // now return this to sonarr
                                        const dllink = 'https://www.bbc.co.uk/iplayer/episode/' + match[5];
                                        const enclosure = `<enclosure url="${dllink}" length="796681201" type="application/x-bittorrent" /><pubDate>${episode.airstamp}</pubDate>`

                                        const iplayer_moniker = `${showres.data['name']} - ${sonarrNaming} - 1080p - ${episode.name}: ${match[5]}`
                                        const dn = encodeURIComponent(iplayer_moniker)
                                        const content = fs.readFileSync(__dirname + "/" + "tvsearchtemplate.xml").toString();
                                        const result = content.replace('<<imdbid>>', showres.data['externals']['imdb'])
                                                              .replace('<<tvdbid>>', req.query['tvdbid'])
                                                              .replace('<<content>>', enclosure)
                                                              .replace('<<pid>>', match[5])
                                                              .replace('<<title>>', iplayer_moniker)
                                                              .replace('<<dllink>>', dllink)
                                                              .replace('<<dn>>', dn);
                                        res.end(result)
                                    }
                                }
                            }
                        }
                    });
                    break;

                }
            }

            });
        });
    } else {
        res.sendFile(__dirname + "/" + "blanktvsearch.xml")
    }
})

app.post('/json', function(req, res) {
    console.log('a req');
    console.log(req.originalUrl)
    console.log(req.body)

    const response = {}
  response['id'] = req.body['id']
  if(req.body['method']) {
    switch(req.body['method']) {
        case 'auth.login':
            response['result'] = true
            res.status(200);
            res.cookie('deluge-login', 'cookie')
            res.end(JSON.stringify(response))
            break;
        case 'web.connected':
            response['result'] = true
            res.status(200);
            res.end(JSON.stringify(response))
            break;
        case 'daemon.info':
            response['result'] = true
            res.status(200);
            res.end(JSON.stringify(response))
            break;
        case 'web.update_ui':
            response['result'] = {}
            res.status(200);
            res.end(JSON.stringify(response))
            break;
        case 'core.add_torrent_magnet':
            const fakeMagnetLink = req.body['params'][0];
            const parse = queryString.parse(fakeMagnetLink)
            const iplayerPid = parse['tr'].replace('https://www.bbc.co.uk/iplayer/episode/', '');
            const title = parse['dn'];
            // save request?
            response['result'] = {}
            res.status(200);
            res.end(JSON.stringify(response))
            break;


    }
  } else {
    res.sendStatus(405);
  }



})

var server = app.listen(8081, function () {
   var host = server.address().address
   var port = server.address().port
   console.log("Example app listening at http://%s:%s", host, port)
})