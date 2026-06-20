/* eslint-disable @next/next/no-img-element */

export default function TrustedCompanies() {
  return (
    <section className="relative z-10 w-full py-16">
      <div className="max-w-5xl mx-auto max-md:px-4">
        <div className="flex flex-col-reverse md:flex-row items-center justify-center max-h-[450px] gap-6">
          <img
            src="/assets/features/image-7.svg"
            alt="features showcase"
            className="hover:-translate-y-1 transition-all duration-300"
          />
          <img
            src="/assets/features/image-8.svg"
            alt="features showcase"
            className="hover:-translate-y-1 transition-all duration-300 max-md:w-full"
          />
        </div>
      </div>
    </section>
  );
}
