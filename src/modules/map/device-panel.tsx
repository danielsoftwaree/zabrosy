import { useState } from 'react';
import { Button } from '../../shared/ui';
import { requestSensorPermissions, relativeAngle, type SensorPermission } from '../../shared/platform/sensors';
import { useDeviceReadings } from '../../shared/platform/use-device-readings';

const labels: Record<SensorPermission, string> = {
  granted: 'Доступ разрешён', denied: 'Доступ отклонён', unavailable: 'API отсутствует',
  insecure: 'Нужен HTTPS или localhost', error: 'Не удалось запросить доступ',
};
const degrees = (value: number | null | undefined) => value == null ? 'Нет данных' : `${value.toFixed(1)}°`;

export function DevicePanel() {
  const [permissions, setPermissions] = useState<{ orientation: SensorPermission; motion: SensorPermission } | null>(null);
  const [pending, setPending] = useState(false);
  const [running, setRunning] = useState(false);
  const [zero, setZero] = useState<number | null>(null);
  const [location, setLocation] = useState<string>('Координаты не запрашивались');
  const [locating, setLocating] = useState(false);
  const readings = useDeviceReadings(running && permissions?.orientation === 'granted', running && permissions?.motion === 'granted');
  const orientation = readings.orientation?.value;
  const motion = readings.motion?.value;

  async function enable() {
    setPending(true);
    setZero(null);
    const result = await requestSensorPermissions();
    setPermissions(result);
    setRunning(true);
    setPending(false);
  }

  function locate() {
    if (!window.isSecureContext || !navigator.geolocation) {
      setLocation('Геолокация недоступна: проверь HTTPS и поддержку браузера.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)} · точность ±${Math.round(coords.accuracy)} м`);
        setLocating(false);
      },
      (error) => {
        setLocation(error.code === 1 ? 'Доступ к геолокации отклонён.' : 'Координаты не получены. Повтори на открытом месте.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <section className="device-panel">
      <p>Проверь доступ к датчикам на своём телефоне. Разрешение ещё не означает, что браузер передаёт показания.</p>
      <div className="device-actions">
        <Button type="button" onClick={() => { void enable(); }} disabled={pending || running}>
          {pending ? 'Запрашиваем доступ…' : 'Включить датчики'}
        </Button>
        {running && <Button type="button" onClick={() => { setRunning(false); setZero(null); }}>Остановить</Button>}
      </div>
      <p role="status">{permissions ? `Ориентация: ${labels[permissions.orientation]}. Движение: ${labels[permissions.motion]}.` : 'Датчики выключены.'}</p>
      {running && <p>{readings.orientation || readings.motion ? 'Получаем показания' : 'Свежих показаний нет. Возможно, датчик недоступен.'}</p>}
      <dl>
        <dt>Поворот α</dt><dd>{degrees(orientation?.alpha)}</dd>
        <dt>Наклон β / γ</dt><dd>{degrees(orientation?.beta)} / {degrees(orientation?.gamma)}</dd>
        <dt>Компас устройства</dt><dd>{degrees(orientation?.heading)}{orientation?.accuracy != null && ` · ±${degrees(orientation.accuracy)}`}</dd>
        <dt>Относительно нуля</dt><dd>{degrees(zero !== null && orientation?.alpha != null ? relativeAngle(orientation.alpha, zero) : null)}</dd>
        <dt>Скорость поворота α</dt><dd>{motion?.rotation.alpha == null ? 'Нет данных' : `${motion.rotation.alpha.toFixed(1)}°/с`}</dd>
        <dt>Ускорение X / Y / Z</dt><dd>{motion ? [motion.acceleration.x, motion.acceleration.y, motion.acceleration.z].map((value) => value === null ? '—' : value.toFixed(2)).join(' / ') + ' м/с²' : 'Нет данных'}</dd>
      </dl>
      <Button type="button" disabled={orientation?.alpha == null} onClick={() => setZero(orientation?.alpha ?? null)}>Принять направление за ноль</Button>
      <p>Поворот относительно нуля — диагностическое значение. При изменении положения телефона он не определяет направление заброса. Глубину и расстояние по этим показаниям не вычисляем.</p>
      <Button type="button" onClick={locate} disabled={locating}>{locating ? 'Определяем положение…' : 'Проверить GPS'}</Button>
      <p role="status">{location}</p>
      <p>Показания этой проверки не сохраняются и не отправляются на сервер.</p>
    </section>
  );
}
