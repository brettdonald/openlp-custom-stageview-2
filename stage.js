const openLPHost = '127.0.0.1'                                                        // castle hill church PC = 192.168.35.11
const openLPRequestPort = '4316'                                                      // port for regular API requests
const openLPWebSocketPort = '4317'                                                    // port for WebSocket connection/messages
const openLPFetchTimeout = 1000                                                       // time to wait for OpenLP to respond
const openLPRetry = 5000                                                              // retry delay after an unsuccessful fetch
const widthTest = document.getElementById('width-test')
const tags = document.querySelector('#meta > :first-child')
const clock = document.querySelector('#meta > :last-child')
const content = document.getElementById('content')
const status = document.getElementById('status')
let itemID = null
let slideIndex = null
let openLPWebSocket = null

const rootStyleRule = Array.from(document.styleSheets[0].cssRules).find(r => r.selectorText == ':root')                   // extract values from :root style rule
const lyricsFontSize = Number(rootStyleRule.styleMap.get('--fontsize-lyrics')[0].match(/\d+(?=vw)/)[0])                   // strip units (vw) and convert to number

// function to replace straight quotes with curly quotes (sourced from https://gist.github.com/karbassi/6216484)
const curlify = t => {
  return t
    .replace(/(^|[-\u2014\s(\["])'/g, "$1\u2018")                                     // opening singles
    .replace(/'/g, "\u2019")                                                          // closing singles & apostrophes
    .replace(/(^|[-\u2014/\[(\u2018\s])"/g, "$1\u201c")                               // opening doubles
    .replace(/"/g, "\u201d")                                                          // closing doubles
    .replace(/--/g, "\u2014")                                                         // em-dashes
}

// function to manage the display of errors
const errorDisplay = (message, click = false) => {
  if (click)                                                                          // if the user clicked for more information
    status.innerHTML = status.dataset.message                                         // display the error message text
  else {
    status.innerHTML = message ? '🟠' : ''                                            // if we received a message, display an orange circle, otherwise display nothing
    status.dataset.message = message ? message : ''                                   // if we received a message, store it in case the user clicks for more information
  }
}

// add a click handler for the status icon
status.addEventListener('click', evt => {                                             
  errorDisplay(null, true)                                                            // display more information about the error to the video team
})

const clockTick = () => {
  const today = new Date()
  let h = today.getHours().toString()
  let m = today.getMinutes().toString().padStart(2, "0")
  clock.firstElementChild.innerHTML = h
  clock.lastElementChild.innerHTML = m
  setTimeout(clockTick, 5000)
}
clockTick()

const slowScrollTo = (element, duration = 2000) => {                                  // custom slow scroll function
  if (!element) return
  const elementPosition = element.getBoundingClientRect().top                         // get the element’s position relative to the viewport
  const startPosition = window.pageYOffset                                            // get starting position (current scroll position)
  const distance = elementPosition - (window.innerWidth / 100 * 3 * 3)                // calculate distance to scroll
  let startTime = null

  const animation = currentTime => {
    if (startTime === null) startTime = currentTime
    const timeElapsed = currentTime - startTime
    const scrollY = easeInOutCubic(timeElapsed, startPosition, distance, duration)
    window.scrollTo(0, scrollY)
    if (timeElapsed < duration) requestAnimationFrame(animation)
  }

  const easeInOutCubic = (t, b, c, d) => {                                            // easing function for smooth acceleration and deceleration
    t /= d/2
    if (t < 1) return c/2*t*t*t + b
    t -= 2
    return c/2*(t*t*t + 2) + b
  }
  
  requestAnimationFrame(animation)
}

const loadImage = async () => {
  try {
    const response = await fetch('/api/v2/core/live-image')
    if (response.ok) {
      const data = await response.json()
      console.log(data)
      content.querySelector('img').src = data.binary_image
    }
    else
      throw new Error(`OpenLP server returned HTTP error ${response.status}`)
  }
  catch (e) {
    let message = ''                                                                  // assemble error message
    if (e.name == 'AbortError' || e.name == 'TypeError') message = `No response from OpenLP on ${openLPHost}`
    else message = e.message
    errorDisplay(message)                                                             // subtly alert the video team that an error occurred
  }
}

const changeSlide = (json, index, fast = false) => {
  tags.querySelector('.current')?.classList.remove('current')
  tags.children[index]?.classList.add('current')
  // if slide is a song
  if (json.name == 'songs') {
    content.querySelector('.current')?.classList.remove('current')
    content.children[index]?.classList.add('current')
    if (fast) slowScrollTo(content.children[index], 500)
    else setTimeout(() => {slowScrollTo(content.children[index], 2000)}, 400)
  }
  else {
    // else (if slide is an image)
    content.innerHTML = `<img src="${json.slides[index].img}">`
    loadImage()
  }
}

// functions to determine whether the current slide contains meta information such as CCLI details
const isCCLI = i => {
  return typeof i.tag === 'string' && (i.tag.startsWith('I') || i.tag.startsWith('O')) && (i.html.match(/©|ccli|lyrics|music|publish/i) != null)
}
const notCCLI = i => {
  return !isCCLI(i)
}

// function to retrieve the current item from OpenLP and if it’s a song, render the current lyrics
const fetchOpenLP = async () => {

  // if the websocket connection isn’t open, abort
  if (openLPWebSocket.readyState != WebSocket.OPEN) return
  
  let response = null
  let json = null
  
  // retrieve current item from OpenLP
  try {
    response = await fetch(`/api/v2/controller/live-items`, {signal: AbortSignal.timeout(openLPFetchTimeout)})
    if (response.ok)
      json = await response.json()
    else
      throw new Error(`OpenLP server returned HTTP error ${response.status}`)
  }
  catch (e) {
    let message = ''                                                                  // assemble error message
    if (e.name == 'AbortError' || e.name == 'TypeError') message = `No response from OpenLP on ${openLPHost}`
    else message = e.message
    errorDisplay(message)                                                             // subtly alert the video team that an error occurred
    setTimeout(fetchOpenLP, openLPRetry)                                              // wait a while then retry
    return
  }

  // our call to OpenLP succeeded, so hide any errors which may have been displayed previously
  errorDisplay(null)

  // is this a different item from what we are already displaying?
  if (json.id != itemID) {
    itemID = json.id                                                                  // update
    slideIndex = null                                                                 // reset

    //console.log(json)
    document.body.className = json.name
    
    // if this item is a song
    if (json.name == 'songs') {                                                       // yes, it is a song
      content.innerHTML = ''
      window.scrollTo(0, 0)
      widthTest.style.fontSize = null                                                 // reset
      widthTest.innerHTML = curlify(json.slides.filter(notCCLI).map(o => o.html).join('<br>'))        // render the entire song in a hidden element
      let fs = lyricsFontSize;                                                        // standard size extracted from style rule
      // if the song is wider than the body, reduce the font size until it fits
      while (document.body.clientWidth < widthTest.clientWidth) {
        fs = fs - 0.1                                                                 // reduce by 0.1vw each time
        widthTest.style.fontSize = fs + 'vw'
      }
      const a = [], b = []
      json.slides.forEach(s => {
        a.push(`<p ${isCCLI(s) ? 'class="ccli"' : ''}>${curlify(s.html)}</p>`)
        b.push(`<span>${s.tag}</span>`)
      })
      content.style.fontSize = widthTest.style.fontSize
      content.innerHTML = a.join('')
      tags.innerHTML = b.join('')
    }
    else if (json.name == 'images') {
      widthTest.innerHTML = ''
      const b = []
      json.slides.forEach(s => {
        b.push(`<span>${s.tag}</span>`)
      })
      tags.innerHTML = b.join('')
      content.innerHTML = ''
      // these next two lines are to work around a bug in chromium/webkit
      content.style.display = "none"
      setTimeout(() => {content.style.removeProperty('display')}, 50)
    }
    else {
      widthTest.innerHTML = ''
      content.innerHTML = ''                                                          // it’s neither a song nor an image, so clear the screen
      tags.innerHTML = ''
    }
  }

  // is this is different slide from what we are already displaying?
  if (json.name == 'songs' || json.name == 'images') {
    const fetchedIndex = json.slides.findIndex(o => o.selected)
    if (fetchedIndex != slideIndex) {
      const reverse = slideIndex == null || fetchedIndex < slideIndex
      slideIndex = fetchedIndex
      changeSlide(json, fetchedIndex, reverse)
    }
  }
}

/***** WebSockets documentation *****
OpenLP: https://gitlab.com/openlp/wiki/-/wikis/Documentation/websockets
Spec:   https://websockets.spec.whatwg.org/#websocket-ready-state                     */

// function to connect to the OpenLP WebSocket and start listening for messages
const connectOpenLP = () => {
  openLPWebSocket = new WebSocket(`ws://${openLPHost}:${openLPWebSocketPort}`)
  openLPWebSocket.onopen = evt => {
    console.info(`Connected to OpenLP on ${openLPHost}`)
    errorDisplay(null)
  }
  openLPWebSocket.onclose = evt => {
    errorDisplay(`Failed to connect to OpenLP on ${openLPHost}`)
    setTimeout(connectOpenLP, openLPRetry)
  }
  openLPWebSocket.onmessage = evt => {
    fetchOpenLP()                                                                     // fetch the current state from OpenLP. We ignore the message contents; the arrival of the message is simply a trigger. Should the message contents be needed in future, the OpenLP documentation (link above) contains a code sample.
  }
}

connectOpenLP()
