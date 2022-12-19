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
const states = [
    'Paused',
    'Downloading',
    'Moving', 
]

app.use(express.json());

function episodeTitleMatcher(match, epname) {
    const process = function(s) {
        return s.replace('&', 'and')
                .replace(/ /gm,'')
                .toLowerCase()
    }
    return process(match) == process(epname)
}

function changeQueueItemState(itemId, newState){
    config = db.get('config')
    for(const torrent in config.queue) {
        if(config.queue[torrent].id == itemId) {
            config.queue[torrent].state = newState
        } 
    }
    db.set('config', config);
}

function releaseSlotById(id){
    var config = db.get('config')
    var index = config.slots.indexOf(id);
    if (index !== -1) {
        config.slots.splice(index, 1);
    }
    db.set('config', config);
}


async function assignSlot() {
    const config = db.get('config');
    if(config.completedDir) {
        let active = null
        if(config.slots.length < config.slotnum){
            for(const torrent in config.queue) {
                if(config.queue[torrent].state == "Paused"){
                    active = config.queue[torrent]
                    config.slots.push(config.queue[torrent].id);
                    db.set('config', config);
                    break;
                }
            }   
        }
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
        let status = torrent.state != 'Complete' ? torrent.state : 'Complete'
        status = status == 'Downloading' ? 'Active' : status
        const template =  {
            'hash': torrent.id,         
            'name': torrent.dn,
            'state': status,         
            'progress': torrent.state != 'Complete' ? 0.1 : 100,
            'eta': torrent.state != 'Complete' ? 99999 : 0,
            // 'message': 'queued',
            'is_finished': torrent.state != 'Complete' ? false : true,
            'save_path':  torrent.state == 'Complete' ?'/downloads/complete/' + '/' : '',
            'total_size': torrent.state != 'Complete' ? 0 : 10000,    
            'total_done': torrent.state != 'Complete' ? 0 : 10000,    
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

function get_iplayer_command(pid, safedn, dir) {
    return `get-iplayer --subs-embed --force --pid=${pid} --file-prefix="${safedn}" --output="${dir}"`
}

async function worker(active, completedDir) {
    if(active == undefined || completedDir == undefined) {
        console.log('no record')
        return
    }
    changeQueueItemState(active.id, 'Downloading')
    const dir = './tmp/' + active.pid + '/'
    if (!fs.existsSync(dir, 777)){
        fs.mkdirSync(dir);
    }
    const safedn = active.dn.replace(/ /g, '.')
    exec(get_iplayer_command(active.pid, safedn, dir), (error, stdout, stderr) => {
        if(error || stderr) {
            console.log(error)
            console.log(stderr)
            return
        }
        if(stdout) {
            releaseSlotById(active.id)
            changeQueueItemState(active.id, 'Moving')
            fs.cp(dir, completedDir + '/' + active.dn + '/', {recursive: true}, function (err) {
                if (err) throw err
                console.log('Successfully moved!')
                changeQueueItemState(active.id, 'Complete')
                fs.rmdir(dir, {force: true, recursive: true}, (err)=>{
                    console.log(err)
                });
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
    let additionalLines = []
    let matches = []
    console.log(req.query)
    if(req.query['t'] == 'caps') {
        res.sendFile(__dirname + "/" + "caps.xml")
    } else if(req.query['t'] == 'tvsearch' && req.query['tvmazeid']) {
        const url = 'https://api.tvmaze.com/shows/' + req.query['tvmazeid'];
        axios.get(url).then(showres => {
            let seriesPid = null;

            const config = db.get('config');
            seriesPid = config.manualPIDMap[showres.data['name']];
            
            if(showres.data['officialSite']) {
                 if(showres.data['officialSite'].startsWith('https://www.bbc.co.uk/programmes/')){
                seriesPid = showres.data['officialSite'].replace('https://www.bbc.co.uk/programmes/', '');
                }
            }

            if(seriesPid == null) {
                res.sendFile(__dirname + "/" + "blanktvsearch.xml")
                return 
            }                


            exec(`get-iplayer --nocopyright --pid=${seriesPid}  --pid-recursive-list `, (error, stdout, stderr) => {
                if (error) {
                    res.sendFile(__dirname + "/" + "blanktvsearch.xml")
                }
                if (stderr) {
                    console.log(`stderr: ${stderr}`);
                    res.sendFile(__dirname + "/" + "blanktvsearch.xml")
                }
                const resultregex = new RegExp(/^(.*)(\ \-\ )(.*)(\,\ .*,\ )(.*)/gm);
                additionalLines = additionalLines.concat([...stdout.matchAll(resultregex)]);
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
                        const partMatches = [...stdout.matchAll(resultregex)]
                        matches = partMatches.concat(additionalLines)
                        axios.get(url+ '/episodes').then(episoderes => {
                        const episodes = episoderes.data;
                        for(const episode of episodes) {
                            if(episode['number'] == req.query['ep'] && episode['season'] == req.query['season']) {
                                const sonarrNaming = `S${zeroPad(episode['season'], 2)}E${zeroPad(episode['number'], 2)}`
                                console.log(matches)
                                // found the one we are looking for
                                if(matches.length == 0) {
                                    res.sendFile(__dirname + "/" + "blanktvsearch.xml")
                                } else {
                                    for(const match of matches) {
                                        if(episodeTitleMatcher(match[3], episode.name)) // matchgroup 3 is the episode title
                                        {
                                            // now return this to sonarr
                                            const dllink = 'https://www.bbc.co.uk/iplayer/episode/' + match[5];
                                            const enclosure = `<enclosure url="${dllink}" length="796681201" type="application/x-bittorrent" /><pubDate>${episode.airstamp}</pubDate>`
            
                                            const iplayer_moniker = `${showres.data['name']}.${sonarrNaming}.1080p`
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
                                            return
                                        }
                                    }
                                    res.sendFile(__dirname + "/" + "blanktvsearch.xml")
                                }
                                break;
            
                            }
                        }
            
                        });
                       
                    }
                });
            
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
            res.end(JSON.stringify(response))
            break;
        case 'core.set_torrent_options':
            res.status(200);
            response['error'] = null;
            res.end(JSON.stringify(response))
            break;
        case 'core.remove_torrent':
            res.status(200);
            response['error'] = null;
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