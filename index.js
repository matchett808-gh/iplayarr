var express = require('express');
var app = express();
var fs = require("fs");
const { exec } = require("child_process");
const axios = require('axios');
// var convert = require('xml-js');
app.use(express.json());



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
                    // found the one we are looking for
                    console.log( showres.data['name'])
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
                            console.log(stdout)
                            if(matches.length == 0) {
                                res.sendFile(__dirname + "/" + "blanktvsearch.xml")
                            } else {
                                for(const match of matches) {
                                    if(match[3] == episode.name) // matchgroup 3 is the episode title
                                    {
                                        // now return this to sonarr
                                        const dllink = 'https://www.bbc.co.uk/iplayer/episode/' + match[5];
                                        const enclosure = `<enclosure url="${dllink}" type="application/x-iplayer" />`
                                        const replace = '<<content>>';
                                        const iplayer_moniker = `${episode.name} ... ${match[5]}`
                                        const content = fs.readFileSync(__dirname + "/" + "tvsearchtemplate.xml").toString();
                                        const result = content.replace(replace, enclosure).replace('<<title>>', iplayer_moniker);
                                        console.log(result)
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


            // exec("get-iplayer --exclude-channel=CBBC --nocopyright --fields=name " + req.query['q'], (error, stdout, stderr) => {
            //     if (error) {
            //         res.sendFile(__dirname + "/" + "blanktvsearch.xml")
            //     }
            //     if (stderr) {
            //         console.log(`stderr: ${stderr}`);
            //         res.sendFile(__dirname + "/" + "blanktvsearch.xml")
            //     }
            //     if(stdout){
            //         const resultregex = new RegExp(/^(\d*):\t(.*)\ \-\ (.*)\,\ (.*),\ (.*)/gm);
            //         const matches = [...stdout.matchAll(resultregex)]
            //         console.log(matches)
            //         if(matches.length == 0) {
            //             res.sendFile(__dirname + "/" + "blanktvsearch.xml")
            //         } else {
            //             const url = 'https://api.tvmaze.com/lookup/shows?thetvdb=' + req.query['tvdbid']
            //             https.get(url, res => {
            //                 if(res.statusCode == 301) {
            //                     https.get(res.headers.location + '/episodes', res => {
            //                         console.log(res)
            //                     });
            //                 }else {
            //                     res.sendFile(__dirname + "/" + "blanktvsearch.xml")
            //                 }
            //             });


            //         }


            //     }
            // });
            
        
    } else {
        console.log('fallback')
        res.sendFile(__dirname + "/" + "blanktvsearch.xml")
    }
})


app.get('/transmission/rpc', function (req, res) {
    console.log('get transmission/rpc')
    console.log(req.originalUrl)
    console.log(req.rawHeaders)
    const response = {}
    response['result'] = 'success'

    // res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Type', 'text/html; charset=ISO-8859-1');
    res.setHeader('Content-Length', '32');
    res.setHeader('Server', 'Transmission');
    res.status(405);
    res.end('<h1>405: Method Not Allowed</h1>')
    // res.end(JSON.stringify(response))
})


app.post('/json', function(req, res) {
    console.log('a req');
    console.log(req.originalUrl)
    console.log(req.body)
/*  body: {
    jsonrpc: '2.0',
    method: 'auth.login',
    params: [ '' ],
    id: '65b3f1e7'
  },
  */
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

    }
  } else {
    res.sendStatus(405);
  }



})
app.all('*', function (req, res) {
    console.log('a req');
    console.log(req.originalUrl)
    console.log(req.method)
    
});


var server = app.listen(8081, function () {
   var host = server.address().address
   var port = server.address().port
   console.log("Example app listening at http://%s:%s", host, port)
})