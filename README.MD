### IPLAYARR

Simple tool to spoof an indexer and download client as a frontend for get-iplayer.

#### Running

Requires your incoming sonarr folder to be mounted to '/mnt/tmission/complete' within the container.

Runs on port 8081, you can map that in docker-compose.yml as you like.

Tools should all be installed, have fun.

#### Sonarr config

Add a Deluge Download client with these settings:

- Name: [important - you'll select this in the indexer so make it unique]
- Host: [IP of your container]
- Port: [8081 or whatever you've mapped it to]

Add a custom torznab indexer with these settings:

- Name: [pick one]
- Enable RSS: False
- URL: [http://10.0.0.194:8081/ <- depends on port and IP of where you are running the container]
- API Path: /sonarr
- Download Client: [Download client set up previously]

Now this should be working

#### Manual PID mapping

For most shows this tool should work - assuming one or more of these conditions are fufilled: 

- the show has broadcasted on BBC in the past 30 days
- Is a BBC original as attributed on TVMaze and the TVMaze API reflects this in the officialSite of the series.
- A manual PID mapping has been provided [!warning - requires changing data.json - follow the example provided for format, must be series PID not an episode] - this is useful for non-BBC originals where it hasn't ran an episode for >30 days.