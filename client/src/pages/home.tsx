import Hero from "@/components/home/Hero";
import CategorySection from "@/components/home/CategorySection";
import FeaturedProperties from "@/components/home/FeaturedProperties";
import LatestProjects from "@/components/home/LatestProjects";
import CallToAction from "@/components/home/CallToAction";
import HowItWorks from "@/components/home/HowItWorks";

const Home = () => {
  return (
    <div>
      <Hero />
      <CategorySection />
      <FeaturedProperties />
      <CallToAction />
      <LatestProjects />
      <HowItWorks />
    </div>
  );
};

export default Home;
