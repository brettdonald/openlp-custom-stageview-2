# OpenLP Custom Stage View 2

An OpenLP Custom Stage View which uses the [OpenLP](https://openlp.org/) API to continuously display song lyrics.
This was developed from our [Overlay Lyrics](https://github.com/brettdonald/overlay-lyrics/assets/4504348/608f7d14-d256-4217-8cfb-f4d7249164e6) project,
which itself was written from scratch. (Our previous custom stage view was based on the
[starter ZIP file](https://manual.openlp.org/stage_view.html#custom-stage-views) provided by OpenLP, however it didn’t
provide proper handling of connection interruptions.)

This stage view has been built to resemble OpenLP’s built-in stage view, but to improve upon it in the following areas:

* larger margins at the edges
* a better-proportioned, more sophisticated and therefore more readable font ([Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans))
* larger font size for better readability, which automatically scales down to avoid line wrap
* meta slides displayed in a smaller font
* smooth scrolling
* header containing the verse order and the clock now handles songs with many verses by scrolling horizontally (automatically).
* image slides are displayed at high resolution

Comparative illustration; standard stage view on the left, this custom stage view on the right:

<img src="https://github.com/user-attachments/assets/86dbf1ab-8a9a-46dd-a46c-203bcf3e400a" />

## Setup

1. Locate the OpenLP data folder using the menu option Tools > Open Data Folder
2. Inside the data folder, create a folder named `stages` if it doesn’t already exist
3. Inside the `stages` folder, create a folder which will be the name of your custom view, for example `mycustom1`
4. Download the files from this GitHub project and place them into the folder `mycustom1`
5. In a web browser, browse the address http://your-openlp-ip-address:4316/stage/mycustom1, 

## Meta Slides

Many songs in our database include meta information about the song on slides tagged with
a verse type of Intro or Other. Slides containing meta information are rendered in a much smaller
font size. This custom stage view identifies meta slides as those:

* with a verse type of Intro or Other, **and**
* which contain any of the following strings:
  * ©
  * ccli
  * lyrics
  * music
  * publish

## Connectivity Logic

OpenLP provides real-time status updates via a [WebSocket connection](https://gitlab.com/openlp/wiki/-/wikis/Documentation/websockets).
Every operation within OpenLP triggers a message over this connection; although each
message contains very limited information. However, receipt of these messages is a useful
trigger to request more detailed information from OpenLP.

Whenever the app receives a message via the WebSocket, it calls the `/controller/live-items`
endpoint of the [OpenLP API](https://gitlab.com/openlp/wiki/-/wikis/Documentation/HTTP-API).
This endpoint responds with detailed information on the currently-displayed item.

If the WebSocket connection cannot be established, a small orange dot appears in the lower
right corner to alert the operator that there is no connection to OpenLP. The operator can
click this orange dot to see error details. This orange dot will also appear if the
connection is terminated, or if a fetch request generates an error or times out.

Following a connection failure or fetch error, the app will automatically continue
attempting to connect, reconnect or refetch at a rate of once every 5 seconds. As soon as
connectivity is established, re-established or the fetch succeeds, the orange dot
disappears.
