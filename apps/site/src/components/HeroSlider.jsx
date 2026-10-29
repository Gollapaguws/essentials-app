import { useEffect, useState } from "react";
import { Image } from "@/components/ui/image";
import { cn } from "@/lib/utils";

export default function HeroSlider({ slides }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setTimeout(
      () => setIndex((current) => (current + 1) % slides.length),
      6500
    );
    return () => clearTimeout(timer);
  }, [index, slides.length]);

  const step = (direction) =>
    setIndex((current) => (current + direction + slides.length) % slides.length);

  return (
    <>
      <div className="noir-slides">
        {slides.map((src, position) => (
          <Image
            key={src}
            src={src}
            alt=""
            fittingType="fill"
            className={cn("noir-slide", position === index && "is-active")}
          />
        ))}
      </div>

      <div className="noir-hero-veil" aria-hidden="true" />

      <div className="noir-slider-ui">
        <div className="noir-dots">
          {slides.map((src, position) => (
            <button
              key={src}
              type="button"
              onClick={() => setIndex(position)}
              aria-label={`Show banner ${position + 1}`}
              aria-current={position === index}
              className={cn("noir-dot", position === index && "is-active")}
            />
          ))}
        </div>

        <div className="noir-slider-right">
          <span className="noir-micro noir-count">
            {String(index + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
          </span>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous banner"
            className="noir-arrow"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next banner"
            className="noir-arrow"
          >
            →
          </button>
        </div>
      </div>
    </>
  );
}