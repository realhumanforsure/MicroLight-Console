declare module 'pidusage' {
  interface Stat {
    cpu: number
    memory: number
  }

  export default function pidusage(pid: number): Promise<Stat>
}
