// Brand artwork imported from the "Visuals File A" Google Drive folder.
const CDN = "https://base44.app/api/apps/6ae368e034a3cd7d85cf47f2/files/mp/public/6ae368e034a3cd7d85cf47f2";
const v = (file) => `${CDN}/${file}`;

export const brand = {
  hero: v("f473fca7a_headphones.jpg"),
  keyVisual: v("f835eb97c_main-image.jpg"),
  crowd:
    "https://media.base44.com/images/public/6ae368e034a3cd7d85cf47f2/50d903e43_generated_image.png",
  wordmark:
    "https://base44.app/api/apps/6ae368e034a3cd7d85cf47f2/files/mp/public/6ae368e034a3cd7d85cf47f2/a9e7667e9_essentials-wordmark-wide.png",
};

export const slides = [
  "https://media.base44.com/images/public/6ae368e034a3cd7d85cf47f2/50d903e43_generated_image.png",
  "https://media.base44.com/images/public/6ae368e034a3cd7d85cf47f2/f8f028a71_generated_59f771ce.jpg",
  "https://media.base44.com/images/public/6ae368e034a3cd7d85cf47f2/96f135e13_generated_b02f6601.jpg",
  "https://media.base44.com/images/public/6ae368e034a3cd7d85cf47f2/17c932de4_generated_13a82e7c.jpg",
  "https://media.base44.com/images/public/6ae368e034a3cd7d85cf47f2/6a63e4413_generated_a289133a.jpg",
  "https://media.base44.com/images/public/6ae368e034a3cd7d85cf47f2/ac2881526_generated_c7c44891.jpg",
  "https://media.base44.com/images/public/6ae368e034a3cd7d85cf47f2/3bd27a3f5_generated_9f66e800.jpg",
];

export const visuals = [
  { src: v("f835eb97c_main-image.jpg"), label: "KEY VISUAL" },
  { src: v("e04bbc7a0_heart-edm.jpg"), label: "THE ESSENTIAL EDM SESSION" },
  { src: v("f473fca7a_headphones.jpg"), label: "HEADPHONE SCHEMATIC" },
  { src: v("32bb501ca_speaker-cone.jpg"), label: "SONIC CONDUIT" },
  { src: v("9a98beca3_no-phone-calls.jpg"), label: "NO PHONE CALLS" },
  { src: v("9b726703e_unplug.jpg"), label: "UNPLUG" },
  { src: v("3858ced7c_disconnect.jpg"), label: "DISCONNECT" },
  { src: v("eba71b457_time.jpg"), label: "TIME" },
  { src: v("b7cba7c77_reach-out.jpg"), label: "REACH OUT" },
  { src: v("568c1cfce_dont-spend-your-frifays.jpg"), label: "DON'T SPEND YOUR FRIDAYS" },
];