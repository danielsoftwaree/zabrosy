import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { MapTrifold } from '@phosphor-icons/react/dist/csr/MapTrifold'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/csr/ArrowSquareOut'
import { Sheet } from '../../shared/ui'
import './bottom.css'

export function DepthSources({ text = false }: { text?: boolean }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className={text ? 'depth-sources__open' : 'map-bottom__settings'} aria-label="Карты глубин Одры" title="Карты глубин Одры" onClick={() => setOpen(true)}><MapTrifold size={21} />{text && 'Карты глубин Одры'}</button>
    <Sheet open={open} onOpenChange={setOpen} title="Карты Одры · Щецин">
      <div className="depth-sources">
        <h3>Цегелинка · ENC P17OD735</h3>
        <p>Официальная карта RIS Odra. Границы листа включают выбранное место в Цегелинке. В файле есть изобаты и области глубин; наличие глубины именно в вашей точке ещё не подтверждено.</p>
        <a className="depth-sources__link" href="https://www.szczecin.uzs.gov.pl/wp-content/uploads/2026/05/P17OD735.zip" target="_blank" rel="noopener noreferrer">Скачать официальный лист · ZIP, 310 КБ <ArrowSquareOut size={18} /></a>
        <p className="depth-sources__note">Публикация файла: 14 мая 2026. Это не дата промера дна. Отсчёт карточных глубин нужно сверять с уровнем воды; они не показывают автоматически сегодняшнюю глубину.</p>
        <h3>Как посмотреть</h3>
        <p>Распакуйте ZIP и откройте файл <strong>P17OD735.000</strong> в CARIS EasyView на компьютере. В Маркере сейчас поддерживаются точки GeoJSON; этот ENC здесь ещё не отображается.</p>
        <a className="depth-sources__link" href="https://www.teledynecaris.com/en/products/free-data-viewer/caris-easy-view" target="_blank" rel="noopener noreferrer">CARIS EasyView <ArrowSquareOut size={18} /></a>
        <a className="depth-sources__link" href="https://www.szczecin.uzs.gov.pl/ris-odra/elektroniczne-mapy-nawigacyjne/pobierz-mapy/" target="_blank" rel="noopener noreferrer">Другие листы Одры и условия использования <ArrowSquareOut size={18} /></a>
        <p className="depth-sources__note">UZS разрешает бесплатный просмотр карты. Для переработки и распространения производных данных требуется письменное согласие, поэтому мы не включаем копию её глубин в приложение.</p>
        <Link className="depth-sources__link" to="/journal" hash="depths" onClick={() => setOpen(false)}>Импортировать свои точки GeoJSON</Link>
      </div>
    </Sheet>
  </>
}
