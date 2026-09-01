import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface ExtraImageLightboxProps {
  src: string;
  alt: string;
  className?: string;
}

const ExtraImageLightbox = ({ src, alt, className }: ExtraImageLightboxProps) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <img
        src={src}
        alt={alt}
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        style={{ cursor: "zoom-in" }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg p-2 bg-background">
          <img
            src={src}
            alt={alt}
            className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ExtraImageLightbox;
