// Light delivery-app map style for Google maps (Android and web): pale roads and buildings,
// grey labels, food and shop places kept visible so people can recognise their street, everything else quiet.
export const LIGHT_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#f5f6f8' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#eceef1' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#e3e6ea' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#dfe3e8' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d6e6f2' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#eef0e8' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e3f1dc' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ saturation: -100 }, { lightness: 25 }] },
  { featureType: 'poi.business', elementType: 'labels.text.fill', stylers: [{ color: '#7b8088' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
];
