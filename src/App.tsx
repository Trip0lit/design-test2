import OrbitalType from '@/components/OrbitalType'

function App() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      <OrbitalType
        text={"Rvpture"}
        colors={["#FFFFFF","#0092ff"]}
        fontWeight={500}
        spacing={0.9}
        flow={0.7000000000000002}
        backOpacity={0.34}
      />
    </main>
  )
}

export default App
