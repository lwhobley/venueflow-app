'use strict';

const { disableTypes } = require('image-size');

// image-size <=2.0.2 can loop forever on malformed ICNS, JXL, and HEIF
// headers (GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq). Venue Wrangler
// does not use these Metro asset formats, so reject them before parsing.
const disabledImageTypes = Object.freeze(['icns', 'jxl', 'heif']);
disableTypes(disabledImageTypes);

module.exports = { disabledImageTypes };
