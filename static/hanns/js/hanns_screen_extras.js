/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN EXTRAS

   Adds three presentation-room behaviours without changing the existing
   Hanns presentation engine:

   1. Clean projector screen
      - slide number / position appears briefly
      - audience QR appears briefly
      - reaction counter appears briefly
      - all of them fade completely away after a few seconds

   2. Host live preview
      - the Big Screen queue drawer gets a small live preview of exactly
        what the current Hanns presentation is showing
      - current slide number is shown next to it

   3. Presenter phone-controller QR on lobby
      - the existing control-code dialog gets "Show on lobby" / "Hide"
      - showing it returns the Big Screen to the lobby first, so the QR and
        controller code never cover the actual presentation slide

   This file is intentionally an enhancement layer. It leaves the current
   hanns_screen.js, present.html, control.html, models and views unchanged.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
"use strict";

const $ = (s, root=document)=>root.querySelector(s);
const CFG = (()=>{

  try{

    const el = $("#scr-cfg");

    return el
      ? JSON.parse(el.textContent || "{}")
      : {};

  }catch(e){

    return {};

  }

})();


let liveIndex = 0;
let liveTotal = 0;

let previewFrame = null;
let previewSrc = "";

let currentRoomFrame = null;

let controllerLobbyVisible = false;

let controllerLobbyData = {

  title:"",
  sharer:"",
  code:"",
  entryUrl:"",

};


/* ──────────────────────────────────────────────────────────────────
   CSS for the additions that live in the Big Screen shell.
   ────────────────────────────────────────────────────────────────── */
function installShellStyles(){

  if($("#hanns-screen-extras-style")) return;

  const style =
    document.createElement("style");

  style.id =
    "hanns-screen-extras-style";

  style.textContent = `

    .scr-live-preview-extra{

      margin:
        0
        0
        1rem;

      padding:
        .85rem;

      border:
        1px
        solid
        var(--scr-line);

      border-radius:
        16px;

      background:
        rgba(
          255,
          255,
          255,
          .035
        );

    }


    .scr-live-preview-extra[hidden]{

      display:
        none
        !important;

    }


    .scr-live-preview-head-extra{

      display:
        flex;

      align-items:
        flex-end;

      justify-content:
        space-between;

      gap:
        1rem;

      margin-bottom:
        .65rem;

    }


    .scr-live-preview-head-extra .left{

      min-width:
        0;

      text-align:
        left;

    }


    .scr-live-preview-head-extra .eyebrow,
    .scr-controller-lobby-extra .eyebrow{

      display:
        block;

      margin-bottom:
        .28rem;

      font:
        700
        .58rem/1
        var(--scr-mono);

      letter-spacing:
        .18em;

      text-transform:
        uppercase;

      color:
        var(--scr-cyan);

    }


    .scr-live-preview-head-extra strong{

      display:
        block;

      max-width:
        34rem;

      white-space:
        nowrap;

      overflow:
        hidden;

      text-overflow:
        ellipsis;

      font-size:
        .95rem;

    }


    .scr-live-preview-head-extra .pos{

      font:
        600
        .68rem/1
        var(--scr-mono);

      color:
        var(--scr-dim);

      white-space:
        nowrap;

    }


    .scr-live-preview-stage-extra{

      position:
        relative;

      width:
        min(
          390px,
          100%
        );

      aspect-ratio:
        16/9;

      overflow:
        hidden;

      border-radius:
        12px;

      background:
        #05040a;

      border:
        1px
        solid
        var(--scr-line-2);

      box-shadow:
        0
        14px
        36px
        rgba(
          0,
          0,
          0,
          .32
        );

    }


    .scr-live-preview-stage-extra iframe{

      position:
        absolute;

      inset:
        0;

      width:
        100%;

      height:
        100%;

      border:
        0;

      pointer-events:
        none;

      background:
        #000;

    }


    .scr-controller-lobby-extra{

      position:
        relative;

      display:
        flex;

      align-items:
        center;

      justify-content:
        center;

      gap:
        1.35rem;

      width:
        min(
          720px,
          90vw
        );

      margin:
        1.35rem
        auto
        1rem;

      padding:
        1rem
        1.2rem;

      border-radius:
        18px;

      text-align:
        left;

      background:
        rgba(
          10,
          8,
          18,
          .82
        );

      border:
        1px
        solid
        rgba(
          139,
          92,
          246,
          .38
        );

      box-shadow:
        0
        20px
        60px
        rgba(
          0,
          0,
          0,
          .36
        );

      backdrop-filter:
        blur(16px);

      -webkit-backdrop-filter:
        blur(16px);

    }


    .scr-controller-lobby-extra[hidden]{

      display:
        none
        !important;

    }


    .scr-controller-lobby-extra .copy{

      min-width:
        0;

      flex:
        1;

    }


    .scr-controller-lobby-extra h2{

      margin:
        .15rem
        0
        .2rem;

      font:
        600
        clamp(
          1.1rem,
          2vw,
          1.55rem
        )/1.2
        var(--scr-display);

      overflow-wrap:
        anywhere;

    }


    .scr-controller-lobby-extra p{

      margin:
        0
        0
        .7rem;

      color:
        var(--scr-dim);

      font-size:
        .88rem;

    }


    .scr-controller-lobby-extra small{

      display:
        block;

      margin-top:
        .5rem;

      color:
        var(--scr-dim);

      font-size:
        .76rem;

      line-height:
        1.45;

    }


    .scr-controller-lobby-code-extra{

      display:
        inline-block;

      padding:
        .55rem
        .8rem;

      border-radius:
        10px;

      background:
        rgba(
          255,
          255,
          255,
          .07
        );

      border:
        1px
        solid
        var(--scr-line-2);

      font:
        700
        clamp(
          1.25rem,
          2.8vw,
          2rem
        )/1
        var(--scr-mono);

      letter-spacing:
        .16em;

      color:
        #fff;

    }


    .scr-controller-lobby-qr-extra{

      flex:
        0
        0
        auto;

      background:
        #fff;

      padding:
        9px;

      border-radius:
        14px;

      line-height:
        0;

    }


    .scr-controller-lobby-qr-extra img,
    .scr-controller-lobby-qr-extra canvas{

      display:
        block;

      width:
        154px;

      height:
        154px;

    }


    .scr-controller-lobby-close-extra{

      position:
        absolute;

      right:
        8px;

      top:
        8px;

      width:
        32px;

      height:
        32px;

      border-radius:
        50%;

      display:
        grid;

      place-items:
        center;

      background:
        rgba(
          255,
          255,
          255,
          .06
        );

      border:
        1px
        solid
        var(--scr-line);

      color:
        var(--scr-dim);

      cursor:
        pointer;

    }


    .scr-controller-lobby-close-extra:hover{

      color:
        #fff;

      background:
        rgba(
          255,
          255,
          255,
          .12
        );

    }


    .scr-controller-lobby-note-extra{

      margin:
        .7rem
        0
        0;

      color:
        #a9a6c2;

      font-size:
        .78rem;

      line-height:
        1.45;

    }


    @media (max-width:700px){

      .scr-controller-lobby-extra{

        flex-direction:
          column;

        text-align:
          center;

      }


      .scr-controller-lobby-extra .copy{

        text-align:
          center;

      }


      .scr-live-preview-stage-extra{

        width:
          100%;

      }

    }

  `;

  document.head.appendChild(
    style
  );

}


/* ──────────────────────────────────────────────────────────────────
   Current Big Screen iframe helpers.
   ────────────────────────────────────────────────────────────────── */
function visibleRoomFrame(){

  return (
    $("#scr-stage .scr-frame.on")
    ||
    $("#scr-stage .scr-frame")
  );

}


function isLobbyVisible(){

  const lobby =
    $("#scr-lobby");

  return !!lobby
    &&
    !lobby.classList.contains(
      "off"
    );

}


function groupedCode(value){

  const code =
    String(
      value
      ||
      ""
    )
    .replace(
      /\s+/g,
      ""
    );

  return (
    code.length
    ===
    6
  )
    ? code.slice(0,3)
      +
      " "
      +
      code.slice(3)

    : code;

}


/* ──────────────────────────────────────────────────────────────────
   CLEAN PROJECTOR HUD

   We inject this only into the embedded presentation iframe used by the
   Big Screen. Normal Hanns /present/ remains unchanged.
   ────────────────────────────────────────────────────────────────── */
function installCleanHud(
  frame,
  previewOnly=false
){

  if(!frame) return;


  let doc;


  try{

    doc =
      frame.contentDocument;

  }catch(e){

    return;

  }


  if(
    !doc
    ||
    !doc.head
    ||
    !doc.body
  ){

    setTimeout(
      ()=>
        installCleanHud(
          frame,
          previewOnly
        ),
      80
    );

    return;

  }


  const styleId =
    previewOnly

      ? "hanns-bigscreen-preview-clean"

      : "hanns-bigscreen-room-clean";


  if(
    !doc.getElementById(
      styleId
    )
  ){

    const style =
      doc.createElement(
        "style"
      );


    style.id =
      styleId;


    if(previewOnly){

      style.textContent = `

        body.hanns-embed .present-controls,
        body.hanns-embed .present-badge,
        body.hanns-embed .reaction-top-stack,
        body.hanns-embed .zoom-pill{

          display:
            none
            !important;

        }


        body.hanns-embed,
        body.hanns-embed *{

          cursor:
            none
            !important;

        }

      `;

    }else{

      style.textContent = `

        body.hanns-embed .present-controls,
        body.hanns-embed .present-badge,
        body.hanns-embed .reaction-top-stack{

          opacity:
            0
            !important;

          pointer-events:
            none
            !important;

          transition:
            opacity
            .32s
            ease,
            transform
            .32s
            ease
            !important;

        }


        body.hanns-embed .present-controls{

          transform:
            translateY(8px)
            !important;

        }


        body.hanns-embed .present-badge{

          transform:
            translateY(8px)
            !important;

        }


        body.hanns-embed .reaction-top-stack{

          transform:
            translateY(-8px)
            !important;

        }


        body.hanns-embed .present-controls button{

          display:
            none
            !important;

        }


        body.hanns-embed.hanns-room-hud .present-controls,
        body.hanns-embed.hanns-room-hud .present-badge,
        body.hanns-embed.hanns-room-hud .reaction-top-stack{

          opacity:
            1
            !important;

          transform:
            none
            !important;

        }

      `;

    }


    doc.head.appendChild(
      style
    );

  }


  if(previewOnly) return;


  if(
    frame.__hannsCleanHudInstalled
  ){

    return;

  }


  frame.__hannsCleanHudInstalled =
    true;


  function flash(ms){

    let body;


    try{

      body =
        frame.contentDocument
        &&
        frame.contentDocument.body;

    }catch(e){

      return;

    }


    if(!body) return;


    body.classList.add(
      "hanns-room-hud"
    );


    clearTimeout(
      frame.__hannsCleanHudTimer
    );


    frame.__hannsCleanHudTimer =
      setTimeout(
        ()=>{

          try{

            const b =
              frame.contentDocument
              &&
              frame.contentDocument.body;


            if(b){

              b.classList.remove(
                "hanns-room-hud"
              );

            }

          }catch(e){}

        },
        Number(ms)
        ||
        3300
      );

  }


  frame.__hannsFlashRoomHud =
    flash;


  /*
   * New reactions briefly show
   * the reaction HUD.
   */
  const reaction =
    doc.getElementById(
      "reaction-counter"
    );


  if(
    reaction
    &&
    window.MutationObserver
  ){

    const observer =
      new MutationObserver(
        ()=>
          flash(
            2200
          )
      );


    observer.observe(
      reaction,
      {
        childList:
          true,

        subtree:
          true,

        characterData:
          true
      }
    );


    frame.__hannsReactionObserver =
      observer;

  }


  /*
   * New audience count changes
   * briefly show the join QR.
   */
  const audience =
    doc.getElementById(
      "aud-count"
    );


  if(
    audience
    &&
    window.MutationObserver
  ){

    const observer =
      new MutationObserver(
        ()=>
          flash(
            1800
          )
      );


    observer.observe(
      audience,
      {
        childList:
          true,

        subtree:
          true,

        characterData:
          true
      }
    );


    frame.__hannsAudienceObserver =
      observer;

  }


  /*
   * Initial QR and page number
   * stay slightly longer.
   */
  flash(
    4200
  );

}


function flashRoomHud(
  ms=3300
){

  const frame =
    visibleRoomFrame();


  if(
    frame
    &&
    typeof
      frame.__hannsFlashRoomHud
      ===
      "function"
  ){

    frame.__hannsFlashRoomHud(
      ms
    );

  }

}


function prepareCurrentRoomFrame(){

  const frame =
    visibleRoomFrame();


  if(
    !frame
    ||
    frame
    ===
    currentRoomFrame
  ){

    return;

  }


  currentRoomFrame =
    frame;


  if(
    frame.contentDocument
    &&
    frame.contentDocument.readyState
      ===
      "complete"
  ){

    installCleanHud(
      frame,
      false
    );

  }else{

    frame.addEventListener(
      "load",
      ()=>
        installCleanHud(
          frame,
          false
        ),
      {
        once:
          true
      }
    );

  }

}


/* ──────────────────────────────────────────────────────────────────
   SMALL LIVE PREVIEW IN HOST DRAWER
   ────────────────────────────────────────────────────────────────── */
function ensurePreviewCard(){

  const body =
    $("#scr-panel .scr-pb");


  if(!body) return null;


  let card =
    $("#scr-live-preview-extra");


  if(card) return card;


  card =
    document.createElement(
      "section"
    );


  card.id =
    "scr-live-preview-extra";


  card.className =
    "scr-live-preview-extra";


  card.hidden =
    true;


  card.innerHTML = `

    <div class="scr-live-preview-head-extra">

      <div class="left">

        <span class="eyebrow">
          Now on screen
        </span>

        <strong id="scr-live-preview-title-extra">
          Presentation
        </strong>

      </div>

      <span
        class="pos"
        id="scr-live-preview-pos-extra">

        Slide 1 / 1

      </span>

    </div>

    <div
      class="scr-live-preview-stage-extra"
      id="scr-live-preview-stage-extra">
    </div>

  `;


  body.insertBefore(
    card,
    body.firstElementChild
  );


  return card;

}


function destroyPreviewFrame(){

  if(previewFrame){

    try{

      previewFrame.remove();

    }catch(e){}


    previewFrame =
      null;

  }


  previewSrc =
    "";


  const host =
    $("#scr-live-preview-stage-extra");


  if(host){

    host.innerHTML =
      "";

  }

}


function syncPreview(){

  const card =
    ensurePreviewCard();


  if(!card) return;


  const roomFrame =
    visibleRoomFrame();


  if(
    !roomFrame
    ||
    !roomFrame.src
    ||
    isLobbyVisible()
  ){

    card.hidden =
      true;


    destroyPreviewFrame();


    return;

  }


  card.hidden =
    false;


  let title =
    "Presentation";


  try{

    title =
      roomFrame.title
      ||
      title;

  }catch(e){}


  $("#scr-live-preview-title-extra")
    .textContent =
      title;


  $("#scr-live-preview-pos-extra")
    .textContent =
      "Slide "
      +
      (
        liveIndex
        +
        1
      )
      +
      " / "
      +
      (
        liveTotal
        ||
        1
      );


  if(
    previewFrame
    &&
    previewSrc
      ===
      roomFrame.src
  ){

    return;

  }


  destroyPreviewFrame();


  previewSrc =
    roomFrame.src;


  const host =
    $("#scr-live-preview-stage-extra");


  if(!host) return;


  const iframe =
    document.createElement(
      "iframe"
    );


  iframe.className =
    "scr-live-preview-iframe-extra";


  iframe.title =
    "Live slide preview";


  iframe.tabIndex =
    -1;


  iframe.setAttribute(
    "aria-hidden",
    "true"
  );


  iframe.allow =
    "autoplay";


  iframe.src =
    previewSrc;


  iframe.addEventListener(
    "load",
    ()=>
      installCleanHud(
        iframe,
        true
      )
  );


  host.appendChild(
    iframe
  );


  previewFrame =
    iframe;

}


/* ──────────────────────────────────────────────────────────────────
   PRESENTER CONTROLLER QR ON LOBBY
   ────────────────────────────────────────────────────────────────── */
function ensureControllerLobbyCard(){

  const lobby =
    $("#scr-lobby .scr-lobby-card");


  if(!lobby) return null;


  let card =
    $("#scr-controller-lobby-extra");


  if(card) return card;


  card =
    document.createElement(
      "section"
    );


  card.id =
    "scr-controller-lobby-extra";


  card.className =
    "scr-controller-lobby-extra";


  card.hidden =
    true;


  card.innerHTML = `

    <button
      class="scr-controller-lobby-close-extra"
      type="button"
      title="Hide controller QR"
      aria-label="Hide controller QR">

      <i class="bi bi-x-lg"></i>

    </button>


    <div class="copy">

      <span class="eyebrow">
        Presenter phone controller
      </span>


      <h2 id="scr-controller-lobby-title-extra">
        Phone controller
      </h2>


      <p id="scr-controller-lobby-who-extra">
      </p>


      <div
        class="scr-controller-lobby-code-extra"
        id="scr-controller-lobby-code-extra">
      </div>


      <small>
        Scan this QR, then enter the
        six-digit code on the phone.
      </small>


      <div class="scr-controller-lobby-note-extra">

        This presenter QR is shown only
        in the lobby and never on top of
        a presentation slide.

      </div>

    </div>


    <div
      class="scr-controller-lobby-qr-extra"
      id="scr-controller-lobby-qr-extra">
    </div>

  `;


  const fullScreenButton =
    $("#scr-go-fs");


  lobby.insertBefore(
    card,
    fullScreenButton
    ||
    null
  );


  card
    .querySelector(
      ".scr-controller-lobby-close-extra"
    )
    .addEventListener(
      "click",
      hideControllerLobby
    );


  return card;

}


function drawControllerLobby(){

  const card =
    ensureControllerLobbyCard();


  if(!card) return;


  card.hidden =
    !controllerLobbyVisible
    ||
    !isLobbyVisible();


  if(card.hidden) return;


  $("#scr-controller-lobby-title-extra")
    .textContent =
      controllerLobbyData.title
      ||
      "Phone controller";


  $("#scr-controller-lobby-who-extra")
    .textContent =
      controllerLobbyData.sharer

        ? "For "
          +
          controllerLobbyData.sharer

        : "For the presenter";


  $("#scr-controller-lobby-code-extra")
    .textContent =
      groupedCode(
        controllerLobbyData.code
      );


  const qr =
    $("#scr-controller-lobby-qr-extra");


  if(!qr) return;


  if(
    qr.dataset.url
    !==
    controllerLobbyData.entryUrl
  ){

    qr.dataset.url =
      controllerLobbyData.entryUrl
      ||
      "";


    qr.innerHTML =
      "";


    try{

      if(
        window.QRCode
        &&
        controllerLobbyData.entryUrl
      ){

        new QRCode(
          qr,
          {

            text:
              controllerLobbyData.entryUrl,

            width:
              154,

            height:
              154,

            colorDark:
              "#111827",

            colorLight:
              "#ffffff",

            correctLevel:
              QRCode.CorrectLevel.M,

          }
        );

      }

    }catch(e){

      qr.innerHTML =
        "";

    }

  }

}


function hideControllerLobby(){

  controllerLobbyVisible =
    false;


  const card =
    $("#scr-controller-lobby-extra");


  if(card){

    card.hidden =
      true;

  }

}


function showControllerLobby(data){

  controllerLobbyData =
    Object.assign(
      {
        title:"",
        sharer:"",
        code:"",
        entryUrl:""
      },
      data
      ||
      {}
    );


  controllerLobbyVisible =
    true;


  /*
   * If a presentation is live,
   * return to lobby first.
   *
   * This is deliberate:
   * presenter credentials never
   * cover a live slide.
   */
  const lobbyButton =
    $("#scr-lobby-btn");


  if(
    !isLobbyVisible()
    &&
    lobbyButton
    &&
    !lobbyButton.disabled
  ){

    lobbyButton.click();

  }


  let tries =
    0;


  const showWhenReady =
    ()=>{

      tries +=
        1;


      drawControllerLobby();


      if(
        !isLobbyVisible()
        &&
        tries
        <
        20
      ){

        setTimeout(
          showWhenReady,
          100
        );

      }

    };


  showWhenReady();

}


function codeFromControlDialog(
  dialog
){

  const spans =
    dialog.querySelectorAll(
      "#dlg-code span"
    );


  return Array
    .from(
      spans
    )
    .map(
      el=>
        (
          el.textContent
          ||
          ""
        )
        .trim()
    )
    .join(
      ""
    );

}


function detailsFromControlDialog(
  dialog
){

  const title =
    (
      dialog
        .querySelector(
          "h2"
        )
        ?.textContent
      ||
      "Phone controller"
    )
    .trim();


  const sharer =
    (
      dialog
        .querySelector(
          "p b"
        )
        ?.textContent
      ||
      ""
    )
    .trim();


  const code =
    codeFromControlDialog(
      dialog
    );


  const entryUrl =
    CFG.controlEntryUrl
    ||
    "";


  return {

    title,
    sharer,
    code,
    entryUrl,

  };

}


function enhanceControlDialog(){

  const dialog =
    $("#scr-dialogs .scr-dlg-card");


  if(
    !dialog
    ||
    dialog.dataset.lobbyQrEnhanced
      ===
      "1"
  ){

    return;

  }


  /*
   * Only enhance the presenter
   * control-code dialog.
   */
  if(
    !dialog.querySelector(
      "#dlg-code"
    )
    ||
    !dialog.querySelector(
      "#dlg-qr"
    )
  ){

    return;

  }


  dialog.dataset.lobbyQrEnhanced =
    "1";


  const actions =
    dialog.querySelector(
      ".scr-dlg-act"
    );


  if(!actions) return;


  const show =
    document.createElement(
      "button"
    );


  show.type =
    "button";


  show.className =
    "scr-btn";


  show.innerHTML =
    '<i class="bi bi-qr-code"></i> Show on lobby';


  show.addEventListener(
    "click",
    ()=>{

      const data =
        detailsFromControlDialog(
          dialog
        );


      const close =
        dialog.querySelector(
          "[data-x]"
        );


      if(close){

        close.click();

      }


      showControllerLobby(
        data
      );

    }
  );


  const hide =
    document.createElement(
      "button"
    );


  hide.type =
    "button";


  hide.className =
    "scr-btn";


  hide.innerHTML =
    '<i class="bi bi-eye-slash"></i> Hide from lobby';


  hide.addEventListener(
    "click",
    ()=>{

      hideControllerLobby();


      const close =
        dialog.querySelector(
          "[data-x]"
        );


      if(close){

        close.click();

      }

    }
  );


  const done =
    actions.querySelector(
      "[data-x]"
    );


  if(done){

    actions.insertBefore(
      show,
      done
    );


    actions.insertBefore(
      hide,
      done
    );

  }else{

    actions.append(
      show,
      hide
    );

  }

}


/* ──────────────────────────────────────────────────────────────────
   EVENTS / OBSERVERS
   ────────────────────────────────────────────────────────────────── */
window.addEventListener(
  "message",
  event=>{

    if(
      event.origin
      !==
      location.origin
      ||
      !event.data
      ||
      !event.data.hannsScreen
    ){

      return;

    }


    const roomFrame =
      visibleRoomFrame();


    if(
      roomFrame
      &&
      event.source
      !==
      roomFrame.contentWindow
    ){

      return;

    }


    const msg =
      event.data;


    if(
      msg.type
      ===
      "slide"
      ||
      msg.type
      ===
      "ready"
    ){

      liveIndex =
        Number(
          msg.index
        )
        ||
        0;


      liveTotal =
        Number(
          msg.total
        )
        ||
        liveTotal
        ||
        1;


      prepareCurrentRoomFrame();


      flashRoomHud(
        msg.type
        ===
        "ready"

          ? 4200

          : 3300
      );


      syncPreview();

    }

  }
);


const stage =
  $("#scr-stage");


if(
  stage
  &&
  window.MutationObserver
){

  new MutationObserver(
    ()=>{

      prepareCurrentRoomFrame();

      syncPreview();

      drawControllerLobby();

    }
  )
  .observe(
    stage,
    {

      childList:
        true,

      subtree:
        false,

    }
  );

}


const lobby =
  $("#scr-lobby");


if(
  lobby
  &&
  window.MutationObserver
){

  new MutationObserver(
    ()=>{

      if(
        !isLobbyVisible()
      ){

        const card =
          $("#scr-controller-lobby-extra");


        if(card){

          card.hidden =
            true;

        }

      }else{

        drawControllerLobby();

      }


      syncPreview();

    }
  )
  .observe(
    lobby,
    {

      attributes:
        true,

      attributeFilter:
        [
          "class"
        ],

    }
  );

}


const dialogs =
  $("#scr-dialogs");


if(
  dialogs
  &&
  window.MutationObserver
){

  new MutationObserver(
    ()=>
      enhanceControlDialog()
  )
  .observe(
    dialogs,
    {

      childList:
        true,

      subtree:
        true,

    }
  );

}


if(
  window.MutationObserver
){

  new MutationObserver(
    ()=>{

      if(
        document.body.classList.contains(
          "scr-panel-open"
        )
      ){

        syncPreview();

      }

    }
  )
  .observe(
    document.body,
    {

      attributes:
        true,

      attributeFilter:
        [
          "class"
        ],

    }
  );

}


/* ──────────────────────────────────────────────────────────────────
   BOOT
   ────────────────────────────────────────────────────────────────── */
function boot(){

  installShellStyles();

  ensurePreviewCard();

  ensureControllerLobbyCard();

  prepareCurrentRoomFrame();

  syncPreview();

  enhanceControlDialog();

  drawControllerLobby();

}


if(
  document.readyState
  ===
  "loading"
){

  document.addEventListener(
    "DOMContentLoaded",
    boot,
    {
      once:
        true
    }
  );

}else{

  boot();

}

})();