const openLPHost = window.location.host.split(':')[0]                                 // extract the host name, truncating any specified port
const openLPWebSocketPort = '4317'                                                    // port for WebSocket connection/messages
const openLPFetchTimeout = 1000                                                       // time to wait for OpenLP to respond
const openLPRetry = 5000                                                              // retry delay after an unsuccessful fetch
const widthTest = document.getElementById('width-test')
const tags = document.querySelector('#meta > :first-child')
const clock = document.querySelector('#meta > :last-child')
const content = document.getElementById('content')
const status = document.getElementById('status')
const xref = []
let itemID = null
let slideIndex = null
let openLPWebSocket = null

//const rootStyleRule = Array.from(document.styleSheets[0].cssRules).find(r => r.selectorText == ':root')                   // extract values from :root style rule
//const lyricsFontSize = Number(rootStyleRule.styleMap.get('--fontsize-lyrics')[0].match(/\d+(?=vw)/)[0])                   // strip units (vw) and convert to number
const lyricsFontSize = 4                                                                                                    // temporary workaround until Firefox adds support for styleMap

// function to replace straight quotes with curly quotes (sourced from https://gist.github.com/karbassi/6216484)
const curlify = t => {
  return t
    .replace(/(^|[-\u2014\s(\["])'/g, "$1\u2018")                                     // opening singles
    .replace(/'/g, "\u2019")                                                          // closing singles & apostrophes
    .replace(/(^|[-\u2014/\[(\u2018\s])"/g, "$1\u201c")                               // opening doubles
    .replace(/"/g, "\u201d")                                                          // closing doubles
    .replace(/--/g, "\u2014")                                                         // em-dashes
}

// function to determine the length of a repeating pattern in an array (sourced from https://share.google/aimode/CQk86NNsgz16XBnMr)
const findRepeatingPattern = arr => {
  const len = arr.length
  for (let patternLen = 1; patternLen <= len / 2; patternLen++) {                     // check every possible pattern length up to half of the array size
    if (len % patternLen === 0) {                                                     // a pattern length must divide the array length perfectly
      let isRepeating = true
      for (let i = patternLen; i < len; i++) {                                        // starting from the second potential pattern ...
        if (arr[i] !== arr[i % patternLen]) {                                         // .. check if this element is different from its corresponding element in the first potential pattern
          isRepeating = false                                                         // yes it’s different, so no pattern exists
          break
        }
      }
      if (isRepeating) return patternLen                                              // no differences were found, so yes, there is a repeating pattern of this length
    }
  }
  return null                                                                         // no repeating pattern was found
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
  if (json.name == 'songs') {                                                         // if slide is a song
    tags.children[xref[index]]?.classList.add('current')
    content.querySelector('.current')?.classList.remove('current')
    content.children[index]?.classList.add('current')
    if (fast) slowScrollTo(content.children[index], 500)
    else setTimeout(() => {slowScrollTo(content.children[index], 1200)}, 100)
  }
  else {                                                                              // else (slide is assumed to be an image)
    tags.children[index]?.classList.add('current')
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

// function to calculate verses from slides and tags ... the OpenLP API doesn't contain any verse information, so it has to be calculated in real time by looking for patterns in the lyrics
const calcTags = slides => {
  
  // create a first array with all tags in sequence and work out if there are any patterns in the text 
  const a1 = []
  slides.forEach(s => {
    const last = a1.at(-1)
    if (last && last.tag == s.tag) last.text.push(s.text)
    else a1.push({tag: s.tag, text: [s.text]})
  })
  a1.forEach(a => a.pattern = findRepeatingPattern(a.text))                           // the return value is the length of the pattern, or null if no pattern was found

  // from this first array, develop an array (a2) of tags for output, and an array (xref) which cross-references slides with tags
  const a2 = []
  let tagIndex = 0
  xref.length = 0
  a1.forEach(a => {
    if (a.pattern) {                                                                  // if this tag contains repeats
      for (i = 0; i < a.text.length / a.pattern; i++) {                               // iterate each repeat
        for (j = 0; j < a.pattern; j++) {                                             // iterate the slides in this repeat
          xref.push(tagIndex)                                                         // cross reference this slide ... the index of xref represents the slide index, the value in it represents the tag index
        }
        a2.push(a.tag)                                                                // push a tag representing this repeat
        tagIndex++
      }
    }
    else {                                                                            // this tag has no repeats
      for (i = 0; i < a.text.length; i++) {                                           // iterate the slides in this tag
        xref.push(tagIndex)                                                           // cross reference the slide
      }
      a2.push(a.tag)
      tagIndex++
    }
  })
  return a2
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
      const a = []
      json.slides.forEach(s => {
        a.push(`<p ${isCCLI(s) ? 'class="ccli"' : ''}>${curlify(s.html)}</p>`)
      })
      content.style.fontSize = widthTest.style.fontSize
      content.innerHTML = a.join('')
      tags.innerHTML = '<span>' + calcTags(json.slides).join('</span><span>') + '</span>'
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
