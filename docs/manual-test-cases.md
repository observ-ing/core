# Manual Test Cases

Test cases for BioSky QA.

---

## Authentication

### TC-AUTH-001: Login flow
**Precondition:** User is logged out
1. Click "Log in" button in header
2. Enter a valid Bluesky handle
3. Complete OAuth flow

**Expected:** User is redirected back, header shows `@handle`, "Log out" button appears

### TC-AUTH-002: Logout flow
**Precondition:** User is logged in
1. Click "Log out" button in header

**Expected:** User is logged out, "Log in" button appears, `@handle` is removed

### TC-AUTH-003: User display fallback
**Precondition:** User is logged in but handle resolution fails
1. Observe header
2. Open upload modal

**Expected:** DID is displayed instead of `@undefined`

---

## Navigation

### TC-NAV-001: Home page load
1. Navigate to `/`

**Expected:** Feed view loads, header shows "BioSky", bottom nav is visible

### TC-NAV-002: Map view load
1. Navigate to `/map`

**Expected:** Map loads with markers (if data exists), controls are visible

### TC-NAV-003: Bottom nav navigation
1. From home, click map icon in bottom nav
2. Verify URL changes to `/map` and map view loads
3. Click home icon
4. Verify URL changes to `/` and feed view loads

**Expected:** Navigation between views works correctly via bottom nav

### TC-NAV-004: 404 page
1. Navigate to `/invalid-route-xyz`
2. Verify 404 page shows with "Page not found" and "Go home" link
3. Click "Go home"

**Expected:** Redirected to `/`

### TC-NAV-005: Occurrence detail page
1. Click on a feed item

**Expected:** Occurrence detail page loads with species info, location, date

---

## Upload Modal

### TC-UPLOAD-001: Open/close modal
1. Click the "+" FAB button
2. Verify upload modal opens with "New Occurrence" title
3. Click "Cancel" or outside modal

**Expected:** Modal closes

### TC-UPLOAD-002: FAB hidden when logged out
**Precondition:** User is logged out
1. Navigate to home page

**Expected:** The "+" FAB button is NOT visible

### TC-UPLOAD-003: Authenticated mode banner
**Precondition:** User is logged in
1. Open upload modal

**Expected:** Banner shows "Posting as @{handle}" or DID if handle unavailable

### TC-UPLOAD-004: Quick species selection
1. Open upload modal
2. Click one of the quick species buttons (e.g., "California Poppy")

**Expected:** Species input is populated with scientific name

### TC-UPLOAD-005: Species autocomplete search
1. Open upload modal
2. Type "quercus" in species input

**Expected:** Autocomplete dropdown appears with oak species suggestions

### TC-UPLOAD-006: Autocomplete no duplicates
1. Open upload modal
2. Type "oak" in species input
3. Wait for suggestions

**Expected:** No duplicate species names in the dropdown

### TC-UPLOAD-007: Autocomplete selection
1. Open upload modal
2. Type "passer" in species input
3. Click on a suggestion

**Expected:** Species input is populated, dropdown closes

### TC-UPLOAD-008: Location auto-detection
1. Allow geolocation permission
2. Open upload modal

**Expected:** Location field shows coordinates

### TC-UPLOAD-009: Submit observation
**Precondition:** User is logged in
1. Open upload modal
2. Select a species
3. Verify location is populated
4. Click "Submit"

**Expected:**
- Submit button shows spinner and "Submitting..." text
- Button remains disabled during submission
- After processing completes, success toast appears
- User is redirected to the new observation's detail page

### TC-UPLOAD-010: FAB visible when logged in
**Precondition:** User is logged in
1. Navigate to home page
2. Verify the "+" FAB button is visible in bottom right corner
3. Click the FAB

**Expected:** Upload modal opens

### TC-UPLOAD-011: Image upload via file picker
**Precondition:** User is logged in
1. Open upload modal
2. Click the image upload area/button
3. Select an image file (JPG, PNG, or WebP)

**Expected:** Image preview appears in the modal

### TC-UPLOAD-012: Image upload with EXIF location
**Precondition:** User is logged in, have a geotagged photo
1. Open upload modal
2. Upload a photo with embedded GPS coordinates

**Expected:** Location field auto-populates from photo EXIF data

### TC-UPLOAD-013: Multiple image upload
**Precondition:** User is logged in
1. Open upload modal
2. Upload first image
3. Upload second image

**Expected:** Both images appear as previews, can remove individual images

### TC-UPLOAD-014: Image removal before submit
**Precondition:** User is logged in
1. Open upload modal
2. Upload an image
3. Click remove button on the image preview

**Expected:** Image is removed from the upload queue

### TC-UPLOAD-015: Submit observation with image
**Precondition:** User is logged in
1. Open upload modal
2. Select a species
3. Upload an image
4. Verify location is populated
5. Click "Submit"

**Expected:**
- Submission completes successfully
- Observation detail page shows uploaded image

### TC-UPLOAD-016: Invalid image file type
**Precondition:** User is logged in
1. Open upload modal
2. Attempt to upload a non-image file (e.g., .txt, .pdf)

**Expected:** Error message displayed, file rejected

### TC-UPLOAD-017: Large image file handling
**Precondition:** User is logged in
1. Open upload modal
2. Upload a very large image (>10MB)

**Expected:** Error message about size limit (max 10MB per image)

---

## Feed View

### TC-FEED-001: Feed loads observations
1. Navigate to `/`

**Expected:** Feed items display with species name, observer, date, location

### TC-FEED-002: Feed item click
1. Click on a feed item

**Expected:** Navigate to occurrence detail page

### TC-FEED-003: Infinite scroll
1. Navigate to `/` with sufficient data
2. Scroll to bottom

**Expected:** More items load automatically

### TC-FEED-004: Home vs Explore tabs
1. Click "Home" tab
2. Note the observations displayed
3. Click "Explore" tab

**Expected:** Explore tab shows global recent observations

### TC-FEED-005: Home feed (authenticated)
**Precondition:** User is logged in
1. Click "Home" tab

**Expected:**
- Feed shows observations from people you follow
- If location permission granted, also shows nearby observations

### TC-FEED-006: Home feed (unauthenticated)
**Precondition:** User is logged out
1. Click "Home" tab

**Expected:** Falls back to showing explore feed (global recent observations)

### TC-FEED-007: Observer name links to profile
1. Navigate to feed
2. Click on an observer's display name

**Expected:** Navigate to `/profile/{did}` for that user

### TC-FEED-008: Observer avatar display
1. Navigate to feed

**Expected:** Each feed item shows observer's avatar (or placeholder if none)

---

## Profile View

### TC-PROFILE-001: Profile page load via URL
1. Navigate to `/profile/did:plc:some-valid-did`

**Expected:** Profile page loads with header, stats, and feed

### TC-PROFILE-002: Profile page from feed
1. Navigate to feed
2. Click an observer's name in a feed item

**Expected:** Profile page loads for that observer

### TC-PROFILE-003: Profile header display
1. Navigate to a user's profile

**Expected:** Header shows avatar, display name, and handle

### TC-PROFILE-004: Profile stats display
1. Navigate to a user's profile

**Expected:** Stats section shows observations, identifications, and species count

### TC-PROFILE-005: Profile feed tabs
1. Navigate to a user's profile
2. Verify three tabs visible: "All", "Observations", "IDs"
3. Click each tab

**Expected:** Feed content filters accordingly

### TC-PROFILE-006: Profile observation item click
1. Navigate to a user's profile
2. Click on an observation item

**Expected:** Navigate to occurrence detail page

### TC-PROFILE-007: Profile page for user with no activity
1. Navigate to profile of user with no observations/identifications

**Expected:** Shows profile header, stats show 0, empty state message in feed

### TC-PROFILE-008: Profile infinite scroll
1. Navigate to profile with many observations
2. Scroll to bottom

**Expected:** More items load automatically

---

## Map View

### TC-MAP-001: Map loads
1. Navigate to `/map`

**Expected:** Map renders with tiles loading

### TC-MAP-002: Observation markers
1. Navigate to `/map` with existing observations

**Expected:** Markers/clusters appear on map at observation locations

### TC-MAP-003: Marker click
1. Click on a map marker

**Expected:** Popup shows observation details

### TC-MAP-004: Map pan/zoom
1. Pan and zoom the map

**Expected:** Map responds, markers update for visible area

---

## Accessibility

### TC-A11Y-001: Keyboard navigation
1. Tab through the page

**Expected:** All interactive elements are focusable in logical order

### TC-A11Y-002: Modal escape key
1. Open upload modal
2. Press Escape key

**Expected:** Modal closes

### TC-A11Y-003: Autocomplete keyboard navigation
1. Open upload modal
2. Type in species input
3. Use arrow keys to navigate suggestions
4. Press Enter to select

**Expected:** Keyboard navigation works

---

## Error Handling

### TC-ERR-001: Network error on feed load
1. Disable network
2. Refresh page

**Expected:** Error message displayed, not blank page

### TC-ERR-002: API error on submission
1. Open upload modal
2. Submit with invalid data

**Expected:** Error toast with descriptive message

---

## Geocoding

### TC-GEO-001: Coordinates are geocoded on submission
**Precondition:** User is logged in
1. Open upload modal
2. Select a species
3. Set location to San Francisco coordinates (37.7749, -122.4194)
4. Submit the observation
5. View the created occurrence in the database or API response

**Expected:** Location includes geocoded fields:
- `continent`: "North America"
- `country`: "United States"
- `countryCode`: "US"
- `stateProvince`: "California"

### TC-GEO-002: International coordinates geocoding
**Precondition:** User is logged in
1. Open upload modal
2. Select a species
3. Set location to Paris coordinates (48.8566, 2.3522)
4. Submit the observation

**Expected:** Location includes:
- `continent`: "Europe"
- `country`: "France"
- `countryCode`: "FR"

### TC-GEO-003: Ocean coordinates handling
**Precondition:** User is logged in
1. Open upload modal
2. Select a species
3. Set location to mid-Pacific Ocean coordinates (0, -140)
4. Submit the observation

**Expected:** Observation is created successfully. Geocoded fields may be empty or contain water body information.

### TC-GEO-004: Location picker search uses geocoding
1. Open upload modal
2. In the location search field, type "Golden Gate Park"
3. Select a result from the autocomplete

**Expected:** Map centers on the location, coordinates are populated

---

## Species Input

### TC-SPECIES-001: Common name autocomplete
1. Open upload modal
2. Type "california poppy" in the species input

**Expected:** Autocomplete shows "Eschscholzia californica" (California Poppy)

### TC-SPECIES-002: Common name with uppercase
1. Open upload modal
2. Type "White Oak" in the species input

**Expected:** Autocomplete shows "Quercus alba" or similar oak species

### TC-SPECIES-003: Partial common name match
1. Open upload modal
2. Type "blue" in the species input

**Expected:** Autocomplete shows species with "blue" in common name (e.g., Blue Jay, Bluebird)

### TC-SPECIES-004: Scientific name still works
1. Open upload modal
2. Type "Quercus" in the species input

**Expected:** Autocomplete shows oak species with scientific names starting with Quercus

### TC-SPECIES-005: Mixed case scientific name
1. Open upload modal
2. Type "quercus alba" (lowercase) in the species input

**Expected:** Autocomplete finds and displays "Quercus alba" correctly
