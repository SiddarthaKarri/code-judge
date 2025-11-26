FROM ghcr.io/engineer-man/piston:latest

# FIX: Update sources.list to use Debian archive (because Buster is EOL)
RUN sed -i 's|deb.debian.org|archive.debian.org|g' /etc/apt/sources.list && \
    sed -i 's|security.debian.org|archive.debian.org/|g' /etc/apt/sources.list && \
    sed -i 's|buster/updates|buster|g' /etc/apt/sources.list

# Install wget
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Create folder for installed language packages
RUN mkdir -p /piston/packages

# Install GCC (C, C++)
RUN cd /piston/packages && \
    wget https://github.com/engineer-man/piston/releases/download/pkgs/gcc-10.2.0.tar.gz && \
    tar -xf gcc-10.2.0.tar.gz && rm gcc-10.2.0.tar.gz

# Install Python
RUN cd /piston/packages && \
    wget https://github.com/engineer-man/piston/releases/download/pkgs/python-3.10.0.tar.gz && \
    tar -xf python-3.10.0.tar.gz && rm python-3.10.0.tar.gz

# Install Node.js
RUN cd /piston/packages && \
    wget https://github.com/engineer-man/piston/releases/download/pkgs/node-18.15.0.tar.gz && \
    tar -xf node-18.15.0.tar.gz && rm node-18.15.0.tar.gz

# Install Java
RUN cd /piston/packages && \
    wget https://github.com/engineer-man/piston/releases/download/pkgs/java-15.0.2.tar.gz && \
    tar -xf java-15.0.2.tar.gz && rm java-15.0.2.tar.gz

EXPOSE 2000
CMD ["piston-api"]
