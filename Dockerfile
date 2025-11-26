FROM ghcr.io/engineer-man/piston:latest

# FIX: Remove broken Debian security repo, point everything to archive.debian.org
RUN sed -i '/deb.debian.org/d' /etc/apt/sources.list && \
    sed -i '/security.debian.org/d' /etc/apt/sources.list && \
    sed -i '/debian-security/d' /etc/apt/sources.list && \
    echo "deb http://archive.debian.org/debian buster main" > /etc/apt/sources.list && \
    echo "deb http://archive.debian.org/debian buster-updates main" >> /etc/apt/sources.list && \
    echo "Acquire::Check-Valid-Until false;" > /etc/apt/apt.conf.d/99no-check-valid && \
    echo "APT::Get::AllowUnauthenticated true;" >> /etc/apt/apt.conf.d/99no-check-valid

# Install wget & certs
RUN apt-get update && \
    apt-get install -y --allow-unauthenticated wget ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Create folder for packages
RUN mkdir -p /piston/packages

# Install GCC (C/C++)
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