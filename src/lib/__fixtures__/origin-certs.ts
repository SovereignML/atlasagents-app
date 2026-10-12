// Self-signed certificates for unit tests only — generated with
//   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 36500 \
//     -subj "/O=Atlas Agents test fixture/CN=<zone>" -addext "subjectAltName=DNS:*.<zone>,DNS:<zone>"
// Nothing trusts them and nothing outside src/**/*.test.ts uses them; the
// private keys are worthless on purpose. Shaped like Cloudflare Origin CA
// certificates (*.<zone> + <zone>), valid until 2126.

/** Covers *.atlasdeploy.xyz and atlasdeploy.xyz. */
export const ATLASDEPLOY_CERT = `-----BEGIN CERTIFICATE-----
MIICAzCCAaqgAwIBAgIULYI28noCDmARJCsnaUIM8M8S6TkwCgYIKoZIzj0EAwIw
PjEiMCAGA1UECgwZQXRsYXMgQWdlbnRzIHRlc3QgZml4dHVyZTEYMBYGA1UEAwwP
YXRsYXNkZXBsb3kueHl6MCAXDTI2MTAxMDIzMjkxNVoYDzIxMjYwOTE2MjMyOTE1
WjA+MSIwIAYDVQQKDBlBdGxhcyBBZ2VudHMgdGVzdCBmaXh0dXJlMRgwFgYDVQQD
DA9hdGxhc2RlcGxveS54eXowWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAS080T4
AOrw9VbjD6B5TuCD1rlvQYSPfhklXi3B7iBl54s+Oq0xk4SkKHOVehsQ1TwmXyZ8
gYsNMB3ONY3kpzu0o4GDMIGAMB0GA1UdDgQWBBRCmxw07rqQ6SeRPdBd22REP9GJ
6jAfBgNVHSMEGDAWgBRCmxw07rqQ6SeRPdBd22REP9GJ6jAPBgNVHRMBAf8EBTAD
AQH/MC0GA1UdEQQmMCSCESouYXRsYXNkZXBsb3kueHl6gg9hdGxhc2RlcGxveS54
eXowCgYIKoZIzj0EAwIDRwAwRAIgC5J/3JDWBCaWguGwXBopTPdBGLR5E/7qxvfA
zAxr4PcCIEq+u5c2PtCinCspHL3r0Pb72Lq5qVNJh+xi5vYg305H
-----END CERTIFICATE-----
`

export const ATLASDEPLOY_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgkivIwbYHlW2/HWi3
J9XRXiq4QnmMs3TJajykvfBqDMqhRANCAAS080T4AOrw9VbjD6B5TuCD1rlvQYSP
fhklXi3B7iBl54s+Oq0xk4SkKHOVehsQ1TwmXyZ8gYsNMB3ONY3kpzu0
-----END PRIVATE KEY-----
`

/** Covers *.sovereignclaw.xyz and sovereignclaw.xyz. */
export const SOVEREIGNCLAW_CERT = `-----BEGIN CERTIFICATE-----
MIICDDCCAbKgAwIBAgIUSd6Ng1YFiU6pJiq7EufAsrg/xqYwCgYIKoZIzj0EAwIw
QDEiMCAGA1UECgwZQXRsYXMgQWdlbnRzIHRlc3QgZml4dHVyZTEaMBgGA1UEAwwR
c292ZXJlaWduY2xhdy54eXowIBcNMjYxMDEwMjMyOTE1WhgPMjEyNjA5MTYyMzI5
MTVaMEAxIjAgBgNVBAoMGUF0bGFzIEFnZW50cyB0ZXN0IGZpeHR1cmUxGjAYBgNV
BAMMEXNvdmVyZWlnbmNsYXcueHl6MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE
XZUy3WOnyaVupBho8HMlE7quCIjcLAGWROpVl7HIq8TvrLnb7v7kNM/p07Iwhzhn
DTVKUA1wilvt4WY7IIbSHaOBhzCBhDAdBgNVHQ4EFgQUDz65WTS1StUKRCcB/99z
dKdjcBowHwYDVR0jBBgwFoAUDz65WTS1StUKRCcB/99zdKdjcBowDwYDVR0TAQH/
BAUwAwEB/zAxBgNVHREEKjAoghMqLnNvdmVyZWlnbmNsYXcueHl6ghFzb3ZlcmVp
Z25jbGF3Lnh5ejAKBggqhkjOPQQDAgNIADBFAiEAx/DskoDYYrr95+WBG7NL/Uaa
OkI+kwRCax6dmV4oaSoCIGc+vwAp51T24W6+jhyAbBjIx46hhvj5KcEFrf2tuXcV
-----END CERTIFICATE-----
`

export const SOVEREIGNCLAW_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgdttk/EgmkVn4ojso
0oncp4uFCjb/wejlrYrtjcEnPRahRANCAARdlTLdY6fJpW6kGGjwcyUTuq4IiNws
AZZE6lWXscirxO+sudvu/uQ0z+nTsjCHOGcNNUpQDXCKW+3hZjsghtId
-----END PRIVATE KEY-----
`
