import MapView from '../components/MapView';
import { useStore } from '../lib/store';
import { Loading } from '../components/ui';

export default function MapPage() {
  const { loading, error } = useStore();
  return (
    <main className="page-map">
      {loading ? <Loading error={error} /> : <MapView full />}
      <div className="map-foot">כלי תומך החלטה. אינו מחליף הוראות דין, תכנית תקפה או שיקול דעת מוסד התכנון. גבולות המתחמים סכמטיים עד לקבלת נספח המתחמים.</div>
    </main>
  );
}
