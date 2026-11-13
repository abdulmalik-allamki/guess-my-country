// The country pool. Flags are built from the ISO code so no emoji is typed by hand.
// Kept free of look-alike pairs with identical flags (Monaco/Indonesia, Chad/Romania).

const RAW = {
  Africa: [
    ["Nigeria", "NG"], ["Egypt", "EG"], ["South Africa", "ZA"], ["Kenya", "KE"],
    ["Morocco", "MA"], ["Ethiopia", "ET"], ["Ghana", "GH"], ["Tanzania", "TZ"],
    ["Algeria", "DZ"], ["Tunisia", "TN"], ["Senegal", "SN"], ["Uganda", "UG"],
    ["Cameroon", "CM"], ["Ivory Coast", "CI"], ["Madagascar", "MG"], ["Angola", "AO"],
    ["Mozambique", "MZ"], ["Zimbabwe", "ZW"], ["Zambia", "ZM"], ["Sudan", "SD"],
    ["Libya", "LY"], ["Rwanda", "RW"], ["Somalia", "SO"], ["Mali", "ML"],
    ["Namibia", "NA"], ["Botswana", "BW"], ["DR Congo", "CD"], ["Mauritius", "MU"],
  ],
  Asia: [
    ["Japan", "JP"], ["China", "CN"], ["India", "IN"], ["South Korea", "KR"],
    ["Indonesia", "ID"], ["Thailand", "TH"], ["Vietnam", "VN"], ["Philippines", "PH"],
    ["Malaysia", "MY"], ["Singapore", "SG"], ["Pakistan", "PK"], ["Bangladesh", "BD"],
    ["Sri Lanka", "LK"], ["Nepal", "NP"], ["Saudi Arabia", "SA"], ["United Arab Emirates", "AE"],
    ["Oman", "OM"], ["Qatar", "QA"], ["Kuwait", "KW"], ["Bahrain", "BH"],
    ["Yemen", "YE"], ["Jordan", "JO"], ["Lebanon", "LB"], ["Syria", "SY"],
    ["Iraq", "IQ"], ["Iran", "IR"], ["Palestine", "PS"], ["Israel", "IL"],
    ["Turkey", "TR"], ["Kazakhstan", "KZ"], ["Uzbekistan", "UZ"], ["Afghanistan", "AF"],
    ["Mongolia", "MN"], ["Cambodia", "KH"], ["Myanmar", "MM"], ["North Korea", "KP"],
    ["Maldives", "MV"], ["Bhutan", "BT"], ["Azerbaijan", "AZ"], ["Georgia", "GE"],
    ["Armenia", "AM"],
  ],
  Europe: [
    ["Germany", "DE"], ["France", "FR"], ["Italy", "IT"], ["Spain", "ES"],
    ["United Kingdom", "GB"], ["Portugal", "PT"], ["Netherlands", "NL"], ["Belgium", "BE"],
    ["Switzerland", "CH"], ["Austria", "AT"], ["Sweden", "SE"], ["Norway", "NO"],
    ["Denmark", "DK"], ["Finland", "FI"], ["Iceland", "IS"], ["Ireland", "IE"],
    ["Poland", "PL"], ["Czechia", "CZ"], ["Hungary", "HU"], ["Romania", "RO"],
    ["Bulgaria", "BG"], ["Greece", "GR"], ["Ukraine", "UA"], ["Russia", "RU"],
    ["Croatia", "HR"], ["Serbia", "RS"], ["Albania", "AL"], ["Bosnia and Herzegovina", "BA"],
    ["Slovakia", "SK"], ["Slovenia", "SI"], ["Estonia", "EE"], ["Latvia", "LV"],
    ["Lithuania", "LT"], ["Luxembourg", "LU"], ["Malta", "MT"], ["Cyprus", "CY"],
  ],
  "North America": [
    ["United States", "US"], ["Canada", "CA"], ["Mexico", "MX"], ["Cuba", "CU"],
    ["Jamaica", "JM"], ["Haiti", "HT"], ["Dominican Republic", "DO"], ["Guatemala", "GT"],
    ["Costa Rica", "CR"], ["Panama", "PA"], ["Honduras", "HN"], ["El Salvador", "SV"],
    ["Nicaragua", "NI"], ["Bahamas", "BS"], ["Trinidad and Tobago", "TT"], ["Barbados", "BB"],
  ],
  "South America": [
    ["Brazil", "BR"], ["Argentina", "AR"], ["Chile", "CL"], ["Colombia", "CO"],
    ["Peru", "PE"], ["Venezuela", "VE"], ["Ecuador", "EC"], ["Bolivia", "BO"],
    ["Paraguay", "PY"], ["Uruguay", "UY"], ["Guyana", "GY"], ["Suriname", "SR"],
  ],
  Oceania: [
    ["Australia", "AU"], ["New Zealand", "NZ"], ["Fiji", "FJ"],
    ["Papua New Guinea", "PG"], ["Samoa", "WS"], ["Tonga", "TO"],
  ],
};

export function flagOf(code) {
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export const COUNTRIES = Object.entries(RAW).flatMap(([continent, list]) =>
  list.map(([name, code]) => ({ name, code, flag: flagOf(code), continent }))
);
