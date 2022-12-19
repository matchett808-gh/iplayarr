var express = require('express');
var app = express();
var fs = require("fs");
const base32 = require('hi-base32');
const { exec } = require("child_process");
const axios = require('axios');
const queryString = require('querystring');
const JSONdb = require('simple-json-db');
const db = new JSONdb('data.json');
var crypto = require("crypto");


if(!db.has('config')){
    db.set('config', {
        "slotnum": 1,
        "slots": [],
        "queue": [],
        "completedDir": '/mnt/tmission/complete'
    });
}


app.use(express.json());

async function assignSlot() {
    const config = db.get('config');
    if(config.completedDir) {
        let active = null
        if(config.slots.length < config.slotnum){
            for(const torrent in config.queue) {
                if(config.queue[torrent].state == "Paused"){
                    active = config.queue[torrent]
                    config.queue[torrent].state = 'Downloading';
                    config.slots.push(config.queue[torrent].id);
                    break;
                }
            }   
        }
        db.set('config', config);
        worker(active, config.completedDir)
    }
}
function get_system_info() {
    assignSlot()
    const config = db.get('config');
    const torrents = {}
    const countAll = config.slots.length + config.queue.length;
    const countActive = config.slots.length; 
    for(const torrent of config.queue) {
        const template =  {
            'hash': torrent.id,         
            'name': torrent.dn,
            'state': torrent.status,         
            'progress': 0.1,
            'eta': 9999999,
            'message': 'queued',
            'is_finished': false,
            'save_path':'',
            'total_size':0,    
            'total_done':0,
            'time_added':0,
            'active_time':0,
            'ratio':0,         
            'is_auto_managed': true,
            'stop_at_ratio':0, 
            'remove_at_ratio':0,
            'stop_ratio':0
        }
        torrents[torrent.id] = template
  

    }
    const sysinfo = {
        connected: true,
        torrents: torrents,
        filters: {
            // state: [
            //     [
            //        "All",
            //        countAll
            //     ],
            //     [
            //        "Active",
            //        countActive
            //     ],
            //     [
            //        "Allocating",
            //        0
            //     ],
            //     [
            //        "Checking",
            //        0
            //     ],
            //     [
            //        "Downloading",
            //        countActive
            //     ],
            //     [
            //        "Seeding",
            //        0
            //     ],
            //     [
            //        "Paused",
            //        0
            //     ],
            //     [
            //        "Error",
            //        0
            //     ],
            //     [
            //        "Queued",
            //        0
            //     ],
            //     [
            //        "Moving",
            //        0
            //     ]
            //  ]
        },
        stats: {
            "max_download":-1.0,
            "max_upload":-1.0,
            "max_num_connections":200,
            "num_connections":0,
            "upload_rate":0.0,
            "download_rate":0.0,
            "download_protocol_rate":0.0,
            "upload_protocol_rate":0.0,
            "dht_nodes":9999,
            "has_incoming_connections":0,
            "free_space":-1,
            "external_ip":"127.0.0.1"
        }
    }

    return sysinfo
}

function worker(active, completedDir) {
    if(active == undefined || completedDir == undefined) {
        console.log('no record')
        return
    }
    const dir = './tmp/' + active.pid + '/'
    if (!fs.existsSync(dir, 777)){
        fs.mkdirSync(dir);
    }
    exec(`get-iplayer --force --pid=${active.pid} --output="${dir}"`, (error, stdout, stderr) => {
        if(error || stderr) {
            console.log(error)
            console.log(stderr)
            return
        }
        if(stdout) {
            var config = db.get('config')
            var index = config.slots.indexOf(active.id);
            if (index !== -1) {
                config.slots.splice(index, 1);
            }
            db.set('config', config);
            config = db.get('config')
            for(const torrent in config.queue) {
                if(config.queue[torrent].id == active.id) {
                    config.queue[torrent].state = 'Complete'
                } 
            }
            db.set('config', config);

            fs.copySync(dir, completedDir + '/' + active.pid + '/', function (err) {
                if (err) throw err
                console.log('Successfully renamed - AKA moved!')
                fs.unlink(dir)
            })

        }
    });

}

function createFakeMagnetLinkHash(dn, pid) {
    return crypto.createHash('sha1').update(dn+pid).digest('hex');
}
function queueJob(jobHash, dn, pid) {
    const id = jobHash
    const config = db.get('config');
    for(const item of config.queue) {
        if (item.pid === pid) {
            return item.id;
        }
    }
    config.queue.push({
        "id": id,
        "dn": dn,
        "pid": pid,
        "state": 'Paused'
    })
    db.set('config', config)
    return id
}

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
                                        const result = content.replace(/<<imdbid>>/g, showres.data['externals']['imdb'])
                                                              .replace(/<<tvdbid>>/g, req.query['tvdbid'])
                                                              .replace(/<<content>>/g, enclosure)
                                                              .replace(/<<pid>>/g, match[5])
                                                              .replace(/<<title>>/g, iplayer_moniker)
                                                              .replace(/<<infohash>>/g, createFakeMagnetLinkHash(dn, match[5]))
                                                              .replace(/<<dllink>>/g, dllink)
                                                              .replace(/<<dn>>/g, dn);
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
    } else {
        res.sendFile(__dirname + "/" + "blanktvsearch.xml")
    }
})

app.post('/json', function(req, res) {
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
            response['result'] = get_system_info();
            res.status(200);
            res.end(JSON.stringify(response))
            break;
        case 'core.add_torrent_magnet':
            const fakeMagnetLink = req.body['params'][0];
            const parse = queryString.parse(fakeMagnetLink)
            const jobHash = parse['magnet:?xt'].replace('urn:btih:', '');
            const iplayerPid = parse['tr'].replace('https://www.bbc.co.uk/iplayer/episode/', '');
            const title = parse['dn'];
            const jobId = queueJob(jobHash, title, iplayerPid);
            response['result'] = jobId;
            res.status(200);
            response['error'] = null;
            console.log(response)
            res.end(JSON.stringify(response))
            break;
        case 'core.set_torrent_options':
            res.status(200);
            response['error'] = null;
            console.log(response)
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

/*
web.updateui
{"result": 
{"connected": true, 
"torrents": {}, "filters": {"state": [["All", 0], ["Active", 0], ["Allocating", 0], ["Checking", 0], ["Downloading", 0], ["Seeding", 0], ["Paused", 0], ["Error", 0], ["Queued", 0], ["Moving", 0]], "tracker_host": [["All", 0], ["Error", 0]], "owner": [["", 0]]}, "stats": {"max_download": -1.0, "max_upload": -1.0, "max_num_connections": 200, "num_connections": 0, "upload_rate": 0.0, "download_rate": 0.0, "download_protocol_rate": 0.0, "upload_protocol_rate": 0.0, "dht_nodes": 107, "has_incoming_connections": 0, "free_space": -1, "external_ip": "77.100.94.58"}}, "error": null, "id": 199}

core.add_torrent_magnet - response is from web.add_torrents - thats an id of some sort
{"result": [[true, "26d8ff278111764607f5f84097e6a94522196302"]], "error": null, "id": 364}


core.get_config_values
{"result": {"add_paused": false, "pre_allocate_storage": false, "download_location": "/downloads", "max_connections_per_torrent": -1, "max_download_speed_per_torrent": -1, "move_completed": false, "move_completed_path": "/downloads", "max_upload_slots_per_torrent": -1, "max_upload_speed_per_torrent": -1, "prioritize_first_last_pieces": false, "sequential_download": false}, "error": null, "id": 310}
*/