"use strict";(()=>{var c=`<div>
  <div class="captcha-container">
    <div class="captcha-header">Captcha</div>
    <div class="captcha-body">
      <input
        type="text"
        id="captcha-input"
        class="captcha-input"
        placeholder="Nh\u1EADp m\xE3 x\xE1c th\u1EF1c"
      />
      <div class="captcha-image-wrapper">
        <img
          id="captcha-image"
          src=""
          alt="Captcha Image"
          style="cursor: pointer"
          title="Nh\u1EA5n \u0111\u1EC3 \u0111\u1ED5i \u1EA3nh m\u1EDBi"
          onclick="refreshCaptcha()"
        />
      </div>
      <button id="captcha-btn" class="captcha-btn" onclick="captchaBtnClick()">X\xE1c th\u1EF1c</button>
      <div
        id="captcha-error"
        style="color: red; font-size: 13px; text-align: center; display: none"
      ></div>
    </div>
  </div>

  <style>
    .captcha-container {
      width: 320px;
      border: 1px solid #d1d1d1;
      border-radius: 5px;
      overflow: hidden;
      font-family: inherit;
      background-color: #ffffff;
    }

    .captcha-header {
      background-color: #f0f0f0;
      padding: 10px 15px;
      font-weight: bold;
      color: #111111;
      font-size: 15px;
    }

    .captcha-body {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .captcha-input {
      width: 100%;
      padding: 10px;
      border: 1px solid transparent;
      background-color: #f5f5f5;
      border-radius: 4px;
      text-align: center;
      font-size: 14px;
      color: #111111;
      box-sizing: border-box;
      outline: none;
    }

    .captcha-input::placeholder {
      color: #888888;
    }

    .captcha-input:focus {
      border-color: #ccc;
    }

    .captcha-image-wrapper {
      width: 100%;
      border-radius: 4px;
      overflow: hidden;
      background-color: #f8f9fa;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .captcha-image-wrapper img {
      width: 100%;
      height: auto;
      display: block;
    }

    .captcha-btn {
      width: 100%;
      padding: 8px;
      background-color: #f2f2f2;
      border: 1px solid #d1d1d1;
      border-radius: 4px;
      font-weight: bold;
      color: #555555;
      cursor: pointer;
      font-size: 14px;
      transition: background-color 0.2s;
    }

    .captcha-btn:hover {
      background-color: #e5e5e5;
    }
  </style>
</div>`,a=()=>{let t=document.getElementById("captcha-image"),e=document.getElementById("captcha-input");t.src="/generate_captcha.php?random="+Math.random(),e.value=""};document.addEventListener("DOMContentLoaded",()=>{let t=document.getElementById("captcha-placeholder");t&&(console.log("Detected captcha placeholder, injecting captcha HTML."),t.innerHTML=c,a())});})();
