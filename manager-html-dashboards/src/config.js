const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const TEAM_MAPPING = require(path.join(ROOT, "sales_leader_team_mapping.json"));

const EBR_USERS = {
  "Alexandra Chirica": "0055c000009mDnLAAU",
  "Anna Sobala": "0055c00000B2k6oAAB",
  "Bouke Kingma": "0055c00000B3BNXAA3",
  "Daniel Spanjaard": "0055c00000B37joAAB",
  "Illane Hamache": "005hR000003j4fFQAQ",
  "Renata Zhupanyn": "005Kg000000lvHkIAI",
  "Renato Taramona": "0055c00000B3BzbAAF",
  "Tommy Hirvonen": "005Kg000000luT6IAI"
};

const MANAGERS = {};
for (const [segment, managers] of Object.entries(TEAM_MAPPING)) {
  for (const [name, assignments] of Object.entries(managers)) {
    MANAGERS[name] = { segment, assignments };
  }
}

const PAGE_SLUGS = {
  "Fernando Munoz Drinot": "fernando-munoz-drinot",
  "Michael de Korte": "michael-de-korte",
  "AJ Herve": "aj-herve",
  "Omur Sert": "omur-sert",
  "Dirk-Jan de Vries": "dirk-jan-de-vries",
  "Carmen Marced": "carmen-marced",
  "Richard Bellet": "richard-bellet",
  "Gilles Chalon": "gilles-chalon"
};

const DIRECTORS = {
  "Richard Bellet": {
    segment: "SMB",
    managers: [
      "AJ Herve",
      "Omur Sert",
      "Fernando Munoz Drinot",
      "Michael de Korte"
    ]
  },
  "Gilles Chalon": {
    segment: "Mid Market",
    managers: ["Carmen Marced", "Dirk-Jan de Vries"]
  }
};

module.exports = { DIRECTORS, EBR_USERS, MANAGERS, PAGE_SLUGS, ROOT };
