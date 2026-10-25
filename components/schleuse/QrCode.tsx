import QRCode from "qrcode";

// Serverseitig zu SVG gerendert. Bewusst KEIN Fremddienst, der aus einer URL
// ein Bild macht: dabei laege der Einladungslink bei einem Dritten - und mit
// ihm die Moeglichkeit, das Konto anzulegen.
export default async function QrCode({ text }: { text: string }) {
  const svg = await QRCode.toString(text, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0a1f3e", light: "#ffffff" },
  });

  return (
    <div
      aria-label="QR-Code zum Einladungslink"
      className="mx-auto w-full max-w-[15rem] rounded-2xl bg-white p-3 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
