/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { PhotonicEngine } from './engine/PhotonicEngine';
import {
  ARENA_LAYERS,
  WAVELENGTHS,
  type ArenaLayerId,
  type EngineUiBridge,
  type WavelengthBand,
} from './engine/types';

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PhotonicEngine | null>(null);

  const [ui, setUi] = useState<EngineUiBridge>({
    layer: 1,
    gameState: 'title',
    pointerLocked: false,
    combo: 0,
    waveIndex: 1,
    totalWaves: 2,
    nearInteractable: null,
    dashReadyMirror: false,
    exposedTargetLocked: false,
    wavelength: 'visible',
  });

  const [dockOpen, setDockOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [selectedStartLayer, setSelectedStartLayer] = useState<ArenaLayerId>(1);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const engine = new PhotonicEngine(el, (snapshot) => {
      setUi(snapshot);
    });
    engineRef.current = engine;

    const canvas = el.querySelector('canvas');
    const onLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onRestored = () => {
      setContextLost(false);
    };
    canvas?.addEventListener('webglcontextlost', onLost);
    canvas?.addEventListener('webglcontextrestored', onRestored);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyH') {
        setDockOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      canvas?.removeEventListener('webglcontextlost', onLost);
      canvas?.removeEventListener('webglcontextrestored', onRestored);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const currentLayerInfo = ARENA_LAYERS.find((l) => l.id === ui.layer) ?? ARENA_LAYERS[0];
  const activeWave = WAVELENGTHS[ui.wavelength];

  const handleEnterObservatory = (layerId: ArenaLayerId) => {
    if (!engineRef.current) return;
    if (layerId !== ui.layer) {
      engineRef.current.selectLayer(layerId);
    } else {
      engineRef.current.startGame();
    }
  };

  const handleToggleMute = () => {
    if (!engineRef.current) return;
    setMuted(engineRef.current.toggleMute());
  };

  const handleSelectLayer = (id: ArenaLayerId) => {
    setSelectedStartLayer(id);
    if (ui.gameState === 'playing' || ui.gameState === 'paused') {
      engineRef.current?.selectLayer(id);
    }
  };

  const handleSelectWavelength = (band: WavelengthBand) => {
    engineRef.current?.setWavelength(band);
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#06080c] text-[#f3efe6]">
      {/* Dedicated WebGL Mount Container */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* WebGL Context Lost Safe Fallback */}
      {contextLost && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#06080c] p-8 text-center">
          <div className="max-w-md space-y-3">
            <h2 className="font-display text-3xl text-[#e5c17b]">Optik Motor Yeniden Başlatılıyor</h2>
            <p className="text-sm text-[#a6adbd]">
              WebGL bağlamı geçici olarak kesildi. Sayfayı yenileyerek fotonik sahneye devam edebilirsiniz.
            </p>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* ACTIVE GAMEPLAY DIEGETIC CROSSHAIR (ZERO-UI: NO HEALTH/SCORE BARS)    */}
      {/* ===================================================================== */}
      {ui.gameState === 'playing' && (
        <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center">
          {/* Minimalist Optical Alignment Hair */}
          <div className="relative flex items-center justify-center">
            <div
              className="h-3 w-3 rounded-full border transition-transform duration-150"
              style={{
                borderColor: ui.exposedTargetLocked
                  ? '#ffe49e'
                  : ui.dashReadyMirror
                    ? activeWave.cssHex
                    : 'rgba(243, 239, 230, 0.55)',
                transform: ui.dashReadyMirror || ui.exposedTargetLocked ? 'scale(1.65)' : 'scale(1)',
              }}
            />
            <div
              className="absolute h-0.5 w-1.5 -left-2.5"
              style={{ backgroundColor: 'rgba(243, 239, 230, 0.45)' }}
            />
            <div
              className="absolute h-0.5 w-1.5 -right-2.5"
              style={{ backgroundColor: 'rgba(243, 239, 230, 0.45)' }}
            />
          </div>

          {/* Contextual Camera Obscura Brass Mirror Crank Hint */}
          {ui.nearInteractable && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-[#0b0f17]/90 border border-[#c89b48]/40 px-4 py-1.5 text-xs tracking-wide text-[#f3efe6]">
              {ui.nearInteractable}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* COLLAPSIBLE BOTTOM CONTROL DOCK (ZERO VIEWPORT OCCLUSION / H TO HIDE) */}
      {/* ===================================================================== */}
      {ui.gameState === 'playing' && (
        <div className="fixed bottom-0 left-1/2 z-20 -translate-x-1/2 flex flex-col items-center">
          <button
            type="button"
            onClick={() => setDockOpen((prev) => !prev)}
            className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium tracking-wide text-[#d4ccb8] bg-[#0a0d14]/90 border border-b-0 border-[#c89b48]/30 hover:text-[#f3efe6] transition-colors cursor-pointer"
            title="Kontrol Panelini Aç/Kapat (H)"
          >
            <span>{currentLayerInfo.code} · {currentLayerInfo.title}</span>
            {dockOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>

          {dockOpen && (
            <div className="w-[min(920px,95vw)] bg-[#0a0d14]/95 border border-[#c89b48]/30 px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
              {/* 5 Handcrafted Optical Layers */}
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {ARENA_LAYERS.map((layer) => {
                  const active = ui.layer === layer.id;
                  return (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => handleSelectLayer(layer.id)}
                      className={`px-3 py-1.5 text-xs whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#c89b48] text-[#090b10] font-semibold'
                          : 'bg-[#131823] text-[#c4cad6] hover:bg-[#1b2232]'
                      }`}
                    >
                      {layer.code}
                    </button>
                  );
                })}
              </div>

              {/* Wavelength Band Selector (Matches Sabre Crystal) */}
              <div className="flex items-center gap-1.5">
                {(['infrared', 'visible', 'ultraviolet'] as WavelengthBand[]).map((band, idx) => {
                  const spec = WAVELENGTHS[band];
                  const active = ui.wavelength === band;
                  return (
                    <button
                      key={band}
                      type="button"
                      onClick={() => handleSelectWavelength(band)}
                      className={`px-2.5 py-1.5 text-xs whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                        active
                          ? 'border-[#f3efe6] bg-[#1b2230] text-[#f3efe6]'
                          : 'border-white/10 bg-[#10141d] text-[#9aa3b4] hover:text-[#f3efe6]'
                      }`}
                    >
                      <span
                        className="inline-block w-2 h-2 mr-1.5 align-middle"
                        style={{ backgroundColor: spec.cssHex }}
                      />
                      {idx + 1} · {spec.nm}nm
                    </button>
                  );
                })}
              </div>

              {/* Audio & Pause */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className="p-2 bg-[#131823] hover:bg-[#1c2333] text-[#d4ccb8] cursor-pointer"
                  aria-label={muted ? 'Sesi Aç' : 'Sesi Kapat'}
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => engineRef.current?.pauseGame()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#131823] hover:bg-[#1c2333] text-[#d4ccb8] cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Duraklat</span>
                </button>
              </div>

              {/* Concise Single-Line Controls Legend */}
              <div className="w-full pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#959eb0]">
                <span>WASD Hareket · Boşluk Zıplama · Fare/Sürükle/Q-E Bakış · Sol Tık/F Prizma Kılıcı · Sağ Tık/G Diyafram Lazeri</span>
                <span>Shift Ayna Yansıma Işınlanması · 1/2/3 Dalga Boyu · T Ayna Çevir · H Paneli Gizle</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* OPENING TITLE SCREEN (OBSERVATORY ARCHITECTURAL PRESENTATION)          */}
      {/* ===================================================================== */}
      {ui.gameState === 'title' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#06080c]/80 p-6">
          <div className="w-full max-w-4xl bg-[#0b0e15] border border-[#c89b48]/35 p-8 md:p-10 space-y-8">
            <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-white/10 pb-6">
              <div>
                <p className="text-xs tracking-[0.2em] text-[#c89b48] uppercase">
                  Enes Öztürk İmzalı Zirve Projesi
                </p>
                <h1 className="font-display text-4xl md:text-5xl font-semibold tracking-tight text-[#f5f0e4] mt-1">
                  LUMINA CORE: THE PHOTONIC ARCHITECT
                </h1>
              </div>
              <div className="text-xs text-[#9ca4b5] flex items-center gap-2">
                <span>Spektral Işık Kırılması</span>
                <span aria-hidden="true">·</span>
                <span>Diegetik Sıfır Arayüz</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-[#c7cdd9]">
              <div className="space-y-1.5">
                <h2 className="font-display text-xl text-[#e5c17b]">Prizma Kılıcı ve Mercek Eldiveni</h2>
                <p className="leading-relaxed text-xs text-[#9ea6b8]">
                  Sağ elinizdeki kuvars kılıcıyla Shadow Malware zırhlarını parçalayıp kristal çekirdekleri açığa çıkarın; sol elinizdeki 10 yapraklı pirinç diyafram eldiveniyle ışığı odaklayarak buharlaştırın.
                </p>
              </div>
              <div className="space-y-1.5">
                <h2 className="font-display text-xl text-[#e5c17b]">Yansıma Işınlanması</h2>
                <p className="leading-relaxed text-xs text-[#9ea6b8]">
                  Savaş alanındaki gümüş ve pirinç aynalara odaklanıp Shift ile geliş açısı = yansıma açısı kanununca ışık hızında sekin; milisaniyelik ağır çekimde spektral ışık okları yağdırın.
                </p>
              </div>
              <div className="space-y-1.5">
                <h2 className="font-display text-xl text-[#e5c17b]">Mutlak Diegetik Telemetri</h2>
                <p className="leading-relaxed text-xs text-[#9ea6b8]">
                  Ekranda sağlık barı veya yapay dijital sayaçlar yoktur. Enerji kapasiteniz sol elinizdeki pirinç diyafram açıklığından, dalga boyunuz kılıç kristalinden, hasarınız ise vizör çatlaklarından okunur.
                </p>
              </div>
            </div>

            {/* 5 Handcrafted Layer Selector */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-[#9ca4b5]">
                <span>Başlangıç Katmanı Seçin (5 El İşçiliği Optik Arena)</span>
                <span>{ARENA_LAYERS[selectedStartLayer - 1].subtitle}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                {ARENA_LAYERS.map((layer) => {
                  const active = selectedStartLayer === layer.id;
                  return (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => setSelectedStartLayer(layer.id)}
                      className={`text-left p-3 border transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#171c28] border-[#c89b48] text-[#f5f0e4]'
                          : 'bg-[#0e121b] border-white/10 text-[#9ca4b5] hover:border-white/25'
                      }`}
                    >
                      <div className="text-[11px] text-[#c89b48]">{layer.code}</div>
                      <div className="text-xs font-medium mt-0.5 truncate">{layer.title}</div>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-[#9ca4b5]">
                {ARENA_LAYERS[selectedStartLayer - 1].description}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-white/10">
              <div className="text-xs text-[#8f97a8]">
                WASD Hareket · Fare Bakış · Sol Tık Kılıç · Sağ Tık Lazer · Shift Yansıma · 1/2/3 Dalga Boyu
              </div>
              <button
                type="button"
                onClick={() => handleEnterObservatory(selectedStartLayer)}
                className="flex items-center gap-2 px-7 py-3 bg-[#c89b48] hover:bg-[#d9ad5b] text-[#090b10] text-sm font-semibold tracking-wide transition-colors cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Gözlemevine Gir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* PAUSE / VICTORY / VISOR SHATTER OVERLAY                               */}
      {/* ===================================================================== */}
      {(ui.gameState === 'paused' || ui.gameState === 'victory' || ui.gameState === 'defeated') && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#06080c]/85 p-6">
          <div className="w-full max-w-lg bg-[#0b0e15] border border-[#c89b48]/35 p-8 space-y-6 text-center">
            <p className="text-xs tracking-[0.2em] text-[#c89b48] uppercase">
              {currentLayerInfo.code} · {currentLayerInfo.title}
            </p>
            <h2 className="font-display text-4xl font-semibold text-[#f5f0e4]">
              {ui.gameState === 'victory'
                ? 'Optik Süper Bilgisayar Aydınlandı'
                : ui.gameState === 'defeated'
                  ? 'Vizör Merceği Kırıldı'
                  : 'Simülasyon Duraklatıldı'}
            </h2>
            <p className="text-sm text-[#9ea6b8] leading-relaxed">
              {ui.gameState === 'victory'
                ? 'Umbra Leviathan tamamen buharlaştırıldı ve beş katmanlı gözlemevi saf yıldız ışığıyla yeniden hizalandı.'
                : ui.gameState === 'defeated'
                  ? 'Karanlık madde darbeleri kask vizörünüzdeki optik mercekleri parçaladı. Kristal çekirdeği yeniden odaklayın.'
                  : 'İstediğiniz optik katmana geçiş yapabilir veya kaldığınız noktadan fotonik savaşa devam edebilirsiniz.'}
            </p>

            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {ARENA_LAYERS.map((layer) => (
                <button
                  key={layer.id}
                  type="button"
                  onClick={() => handleSelectLayer(layer.id)}
                  className={`px-3 py-1.5 text-xs border transition-colors cursor-pointer ${
                    ui.layer === layer.id
                      ? 'bg-[#c89b48] border-[#c89b48] text-[#090b10] font-semibold'
                      : 'bg-[#121621] border-white/10 text-[#c4cad6] hover:border-white/30'
                  }`}
                >
                  {layer.code}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-center gap-3 pt-4">
              {ui.gameState === 'paused' && (
                <button
                  type="button"
                  onClick={() => engineRef.current?.resumeGame()}
                  className="flex items-center gap-2 px-6 py-2.5 bg-[#c89b48] hover:bg-[#d9ad5b] text-[#090b10] text-sm font-semibold cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Devam Et</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => engineRef.current?.restartCurrentLayer()}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#151a26] hover:bg-[#1f2636] border border-white/15 text-[#f3efe6] text-sm cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{ui.gameState === 'victory' ? 'Katmanı Tekrarla' : 'Yeniden Başlat'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
