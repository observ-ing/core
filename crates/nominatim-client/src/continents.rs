use std::collections::HashMap;

/// Map a two-letter country code to its continent (UN geoscheme)
pub(crate) fn country_to_continent(code: &str) -> Option<&'static str> {
    COUNTRY_TO_CONTINENT.get(code).copied()
}

lazy_static::lazy_static! {
    static ref COUNTRY_TO_CONTINENT: HashMap<&'static str, &'static str> = {
        let mut m = HashMap::new();
        // Africa
        for code in ["DZ","AO","BJ","BW","BF","BI","CV","CM","CF","TD","KM","CG","CD","CI","DJ",
                      "EG","GQ","ER","SZ","ET","GA","GM","GH","GN","GW","KE","LS","LR","LY","MG",
                      "MW","ML","MR","MU","MA","MZ","NA","NE","NG","RW","ST","SN","SC","SL","SO",
                      "ZA","SS","SD","TZ","TG","TN","UG","ZM","ZW","RE","YT","SH","EH"] {
            m.insert(code, "Africa");
        }
        // Antarctica
        for code in ["AQ","BV","GS","HM"] {
            m.insert(code, "Antarctica");
        }
        // Asia
        for code in ["AF","AM","AZ","BH","BD","BT","BN","KH","CN","CY","GE","HK","IN","ID","IR",
                      "IQ","IL","JP","JO","KZ","KW","KG","LA","LB","MO","MY","MV","MN","MM","NP",
                      "KP","OM","PK","PS","PH","QA","SA","SG","KR","LK","SY","TW","TJ","TH","TL",
                      "TR","TM","AE","UZ","VN","YE"] {
            m.insert(code, "Asia");
        }
        // Europe
        for code in ["AL","AD","AT","BY","BE","BA","BG","HR","CZ","DK","EE","FI","FR","DE","GR",
                      "HU","IS","IE","IT","XK","LV","LI","LT","LU","MT","MD","MC","ME","NL","MK",
                      "NO","PL","PT","RO","RU","SM","RS","SK","SI","ES","SE","CH","UA","GB","VA",
                      "AX","FO","GG","IM","JE","GI","SJ"] {
            m.insert(code, "Europe");
        }
        // North America
        for code in ["AI","AG","AW","BS","BB","BZ","BM","BQ","VG","CA","KY","CR","CU","CW","DM",
                      "DO","SV","GL","GD","GP","GT","HT","HN","JM","MQ","MX","MS","NI","PA","PR",
                      "BL","KN","LC","MF","PM","VC","SX","TT","TC","US","VI"] {
            m.insert(code, "North America");
        }
        // Oceania
        for code in ["AS","AU","CK","FJ","PF","GU","KI","MH","FM","NR","NC","NZ","NU","NF","MP",
                      "PW","PG","PN","WS","SB","TK","TO","TV","UM","VU","WF","CC","CX"] {
            m.insert(code, "Oceania");
        }
        // South America
        for code in ["AR","BO","BR","CL","CO","EC","FK","GF","GY","PY","PE","SR","UY","VE"] {
            m.insert(code, "South America");
        }
        m
    };
}
