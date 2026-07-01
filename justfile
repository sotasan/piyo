# Task runner. Tools + the .env SDK pin come from mise, so run inside an activated
# mise shell. `[parallel]` fans dependencies out; the graph decides ordering
# (sync -> zmx; zmx + icon -> xcode).
export DATABASE_URL := ".db/dev.sqlite"

# Bootstrap everything in parallel, then open Piyo.xcodeproj yourself.
[parallel]
default: xcode db

# Build the bundled zmx multiplexer from vendored source -> Resources/bin/zmx.
# Vendored source is fetched by `mise install` (vendir sync), not here.
[working-directory('vendor/zmx')]
zmx:
    zig build -Doptimize=ReleaseFast
    mkdir -p ../../Resources/bin
    cp zig-out/bin/zmx ../../Resources/bin/zmx

# Regenerate the AppIcon PNGs from assets/icon.icns (gitignored/derived).
icon:
    rm -rf "$TMPDIR/piyo.iconset"
    iconutil -c iconset assets/icon.icns -o "$TMPDIR/piyo.iconset"
    cp "$TMPDIR/piyo.iconset"/*.png apps/desktop/Sources/Assets.xcassets/AppIcon.appiconset/

# Generate Piyo.xcodeproj — after zmx + icon so the bundled resources exist.
[parallel]
xcode: zmx icon
    xcodegen generate

# Create the local dev DB (crates/core/.db) from migrations.
[working-directory('crates/core')]
db:
    mkdir -p .db
    diesel database setup

# Rebuild the dev DB from migrations and regenerate src/schema.rs (migrations are truth).
[working-directory('crates/core')]
db-prepare:
    mkdir -p .db
    diesel database reset
