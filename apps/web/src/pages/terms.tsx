import CustomLink from '@/components/common/CustomLink'
import type { NextPage } from 'next'
import Head from 'next/head'
import SafeTerms from '@/markdown/terms/terms.md'
import type { MDXComponents } from 'mdx/types'
import { useIsOfficialHost } from '@/hooks/useIsOfficialHost'
import { BRAND_NAME } from '@/config/constants'
import { TERMS_LINK } from '@/config/constants.extra'
import { Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'

const overrideComponents: MDXComponents = {
  a: CustomLink,
}

// Remote-fetched terms for a non-official-host deployment — the official host renders the
// local, reviewed MDX content above instead.
const RemoteTerms = () => {
  const [content, setContent] = useState<string>('')

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const response = await fetch(TERMS_LINK)
        const text = await response.text()
        setContent(text)
      } catch (error) {
        console.error('Error fetching terms:', error)
      }
    }

    fetchContent()
  }, [])

  return content ? <ReactMarkdown>{content}</ReactMarkdown> : <Typography>Loading terms...</Typography>
}

const Terms: NextPage = () => {
  const isOfficialHost = useIsOfficialHost()

  return (
    <>
      <Head>
        <title>{`${BRAND_NAME} – Terms`}</title>
      </Head>

      <main style={{ lineHeight: '1.5' }}>
        {isOfficialHost ? <SafeTerms components={overrideComponents} /> : <RemoteTerms />}
      </main>
    </>
  )
}

export default Terms
