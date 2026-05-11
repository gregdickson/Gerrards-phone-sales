function initPlacesAutocomplete() {
  const input = document.getElementById('address_search');
  if (!input || typeof google === 'undefined') return;

  const autocomplete = new google.maps.places.Autocomplete(input, {
    types: ['address'],
    componentRestrictions: { country: 'nz' },
  });

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place.address_components) return;

    let streetNumber = '';
    let route = '';

    for (const comp of place.address_components) {
      const type = comp.types[0];
      switch (type) {
        case 'street_number':
          streetNumber = comp.long_name;
          break;
        case 'route':
          route = comp.long_name;
          break;
        case 'locality':
        case 'sublocality_level_1':
          setValue('city', comp.long_name);
          break;
        case 'administrative_area_level_1':
          setValue('state', comp.long_name);
          break;
        case 'country':
          setValue('country', comp.short_name);
          break;
        case 'postal_code':
          setValue('postal_code', comp.long_name);
          break;
      }
    }

    setValue('street_address', [streetNumber, route].filter(Boolean).join(' '));
  });
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Initialize when Google Maps loads
if (typeof google !== 'undefined' && google.maps) {
  initPlacesAutocomplete();
} else {
  window.initPlacesAutocomplete = initPlacesAutocomplete;
}
