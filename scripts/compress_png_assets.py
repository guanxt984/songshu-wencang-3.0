from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1] / "assets" / "illustrations"
REFERENCED = {
    "squirrel-wencang-logo-ip.png",
    "squirrel-crayon.png",
    "pinecone-icon.png",
    "leaf-crayon.png",
    "book-crayon.png",
    "star-crayon.png",
    "search-crayon.png",
    "user-crayon.png",
    "plus-crayon.png",
    "more-crayon.png",
    "grass-crayon.png",
    "pinecone-warehouse-icon.png",
    "warehouse-icon-product-manager.png",
    "warehouse-icon-human-nature.png",
    "squirrel-toolbar-perched-v2.png",
}
ROLE_CAPS = {
    "warehouse-icon-product-manager.png": 192,
    "warehouse-icon-human-nature.png": 192,
    "squirrel-wencang-logo-ip.png": 256,
    "squirrel-toolbar-perched-v2.png": 600,
}
BRAND_ASSETS = {
    "warehouse-icon-product-manager.png",
    "warehouse-icon-human-nature.png",
    "squirrel-wencang-logo-ip.png",
    "squirrel-toolbar-perched-v2.png",
}


def compress(path: Path) -> tuple[int, int]:
    original_bytes = path.stat().st_size
    cap = ROLE_CAPS.get(path.name, 96 if path.name in REFERENCED else 384)
    colors = 96 if path.name in BRAND_ASSETS else 64
    with Image.open(path) as source:
        image = source.convert("RGBA")
        image.thumbnail((cap, cap), Image.Resampling.LANCZOS, reducing_gap=3.0)
        image = image.quantize(
            colors=colors,
            method=Image.Quantize.FASTOCTREE,
            dither=Image.Dither.FLOYDSTEINBERG,
        )
        temporary = path.with_suffix(".compressed.png")
        image.save(temporary, format="PNG", optimize=True, compress_level=9)
    temporary.replace(path)
    return original_bytes, path.stat().st_size


def main() -> None:
    before = 0
    after = 0
    for path in sorted(ROOT.glob("*.png")):
        old_size, new_size = compress(path)
        before += old_size
        after += new_size
        print(f"{path.name}: {old_size} -> {new_size} bytes")
    print(f"total: {before} -> {after} bytes")


if __name__ == "__main__":
    main()
