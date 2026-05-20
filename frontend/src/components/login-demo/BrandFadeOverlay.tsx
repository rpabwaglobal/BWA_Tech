import { motion } from 'framer-motion';

export default function BrandFadeOverlay() {
  return (
    <motion.div
      className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-white/95 dark:bg-[#1a0f24]/95 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.55, ease: 'easeOut' }}
        className="flex flex-col items-center gap-[16px] text-center px-[32px]"
      >
        <img
          src="/assets/bwa-tech-black.png"
          alt="BWA Tech"
          className="h-[56px] w-auto dark:hidden"
        />
        <img
          src="/assets/bwa-tech-white.png"
          alt="BWA Tech"
          className="h-[56px] w-auto hidden dark:block"
        />
        <div className="space-y-[6px] max-w-[420px]">
          <p className="text-xl font-semibold text-[var(--color-foreground)]">
            Fácil de usar.
          </p>
          <p className="text-base text-[var(--color-muted-foreground)]">
            Gerenciar uma sprint nunca foi tão fácil.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
